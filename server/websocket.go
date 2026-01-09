package main

import (
	"chess/domain"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

// Client represents a WebSocket client connection
type Client struct {
	conn   *websocket.Conn
	gameID string
	send   chan []byte
}

// Hub maintains the set of active clients per game
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]bool // gameID -> set of clients
}

// NewHub creates a new Hub
func NewHub() *Hub {
	return &Hub{
		clients: make(map[string]map[*Client]bool),
	}
}

// Register adds a client to the hub
func (h *Hub) Register(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[client.gameID] == nil {
		h.clients[client.gameID] = make(map[*Client]bool)
	}
	h.clients[client.gameID][client] = true
	log.Printf("Client connected to game %s (total: %d)", client.gameID, len(h.clients[client.gameID]))
}

// Unregister removes a client from the hub
func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if clients, ok := h.clients[client.gameID]; ok {
		if _, ok := clients[client]; ok {
			delete(clients, client)
			close(client.send)
			log.Printf("Client disconnected from game %s (remaining: %d)", client.gameID, len(clients))
		}
	}
}

// Broadcast sends a message to all clients in a game
func (h *Hub) Broadcast(gameID string, message []byte) {
	h.mu.RLock()
	clients := h.clients[gameID]
	h.mu.RUnlock()

	for client := range clients {
		select {
		case client.send <- message:
		default:
			// Client buffer full, skip
		}
	}
}

var hub = NewHub()

// WSMessage represents a WebSocket message
type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// WSGameUpdate is sent when game state changes
type WSGameUpdate struct {
	Type string   `json:"type"`
	Game GameJSON `json:"game"`
}

// WSChatMessage is sent when a chat message is received
type WSChatMessage struct {
	Type    string      `json:"type"`
	Message ChatMessage `json:"message"`
}

// WSError is sent when an error occurs
type WSError struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

// WebSocketHandler handles WebSocket connections for a game
func WebSocketHandler(w http.ResponseWriter, r *http.Request) {
	// Extract game ID from path: /api/games/{id}/ws
	path := strings.TrimPrefix(r.URL.Path, "/api/games/")
	gameID := strings.TrimSuffix(path, "/ws")

	if gameID == "" {
		http.Error(w, "missing game id", http.StatusBadRequest)
		return
	}

	// Verify game exists
	_, ok := store.Get(gameID)
	if !ok {
		http.Error(w, "game not found", http.StatusNotFound)
		return
	}

	// Upgrade HTTP to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		conn:   conn,
		gameID: gameID,
		send:   make(chan []byte, 256),
	}

	hub.Register(client)

	// Send initial game state
	game, _ := store.Get(gameID)
	initialState := WSGameUpdate{
		Type: "game_update",
		Game: ToGameJSON(game),
	}
	if msg, err := json.Marshal(initialState); err == nil {
		client.send <- msg
	}

	// Send existing chat messages
	messages := chatStore.GetMessages(gameID)
	for _, msg := range messages {
		chatMsg := WSChatMessage{
			Type:    "chat",
			Message: msg,
		}
		if data, err := json.Marshal(chatMsg); err == nil {
			client.send <- data
		}
	}

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// readPump reads messages from the WebSocket connection
func (c *Client) readPump() {
	defer func() {
		hub.Unregister(c)
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Parse incoming message
		var wsMsg WSMessage
		if err := json.Unmarshal(message, &wsMsg); err != nil {
			c.sendError("invalid message format")
			continue
		}

		// Handle different message types
		switch wsMsg.Type {
		case "move":
			c.handleMove(wsMsg.Payload)
		case "chat":
			c.handleChat(wsMsg.Payload)
		case "undo_request":
			c.handleUndoRequest(wsMsg.Payload)
		case "undo_accept":
			c.handleUndoAccept()
		case "undo_reject":
			c.handleUndoReject()
		case "get_moves":
			c.handleGetMoves(wsMsg.Payload)
		default:
			c.sendError("unknown message type: " + wsMsg.Type)
		}
	}
}

// writePump writes messages to the WebSocket connection
func (c *Client) writePump() {
	defer c.conn.Close()

	for message := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			log.Printf("WebSocket write error: %v", err)
			return
		}
	}
}

// sendError sends an error message to the client
func (c *Client) sendError(errMsg string) {
	msg := WSError{Type: "error", Error: errMsg}
	if data, err := json.Marshal(msg); err == nil {
		c.send <- data
	}
}

// handleMove processes a move request
func (c *Client) handleMove(payload json.RawMessage) {
	var req MoveRequestJSON
	if err := json.Unmarshal(payload, &req); err != nil {
		c.sendError("invalid move format")
		return
	}

	game, ok := store.Get(c.gameID)
	if !ok {
		c.sendError("game not found")
		return
	}

	move, err := domain.NewMoveFromNotation(req.From, req.To)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	if req.Promotion != "" {
		promotion := ParsePromotion(req.Promotion)
		if promotion != 0 {
			move = move.WithPromotion(promotion)
		}
	}

	newGame, err := domain.ApplyMove(game, move)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	store.Save(newGame)

	// Broadcast game update to all clients
	broadcastGameUpdate(c.gameID)
}

// handleChat processes a chat message
func (c *Client) handleChat(payload json.RawMessage) {
	var msg ChatMessage
	if err := json.Unmarshal(payload, &msg); err != nil {
		c.sendError("invalid chat format")
		return
	}

	chatStore.AddMessage(c.gameID, msg)

	// Broadcast chat message to all clients
	chatMsg := WSChatMessage{
		Type:    "chat",
		Message: msg,
	}
	if data, err := json.Marshal(chatMsg); err == nil {
		hub.Broadcast(c.gameID, data)
	}
}

// handleUndoRequest processes an undo request
func (c *Client) handleUndoRequest(payload json.RawMessage) {
	var req UndoRequestBodyJSON
	if err := json.Unmarshal(payload, &req); err != nil {
		c.sendError("invalid undo request format")
		return
	}

	game, ok := store.Get(c.gameID)
	if !ok {
		c.sendError("game not found")
		return
	}

	color, valid := ParseColor(req.Color)
	if !valid {
		c.sendError("invalid color")
		return
	}

	newGame := domain.RequestUndo(game, color)
	store.Save(newGame)

	broadcastGameUpdate(c.gameID)
}

// handleUndoAccept processes an undo accept
func (c *Client) handleUndoAccept() {
	game, ok := store.Get(c.gameID)
	if !ok {
		c.sendError("game not found")
		return
	}

	newGame, err := domain.AcceptUndo(game)
	if err != nil {
		c.sendError(err.Error())
		return
	}

	store.Save(newGame)
	broadcastGameUpdate(c.gameID)
}

// handleUndoReject processes an undo reject
func (c *Client) handleUndoReject() {
	game, ok := store.Get(c.gameID)
	if !ok {
		c.sendError("game not found")
		return
	}

	newGame := domain.RejectUndo(game)
	store.Save(newGame)
	broadcastGameUpdate(c.gameID)
}

// handleGetMoves returns legal moves for a position
func (c *Client) handleGetMoves(payload json.RawMessage) {
	var req struct {
		From string `json:"from"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		c.sendError("invalid get_moves format")
		return
	}

	game, ok := store.Get(c.gameID)
	if !ok {
		c.sendError("game not found")
		return
	}

	var moves []domain.Move
	if req.From != "" {
		pos, err := domain.ParsePosition(req.From)
		if err != nil {
			c.sendError("invalid position: " + req.From)
			return
		}
		moves = domain.GetLegalMoves(game, pos)
	} else {
		moves = domain.GetAllLegalMoves(game)
	}

	response := struct {
		Type  string            `json:"type"`
		Moves MovesResponseJSON `json:"moves"`
	}{
		Type:  "moves",
		Moves: ToMovesResponseJSON(moves),
	}

	if data, err := json.Marshal(response); err == nil {
		c.send <- data
	}
}

// broadcastGameUpdate sends the current game state to all clients in the game
func broadcastGameUpdate(gameID string) {
	game, ok := store.Get(gameID)
	if !ok {
		return
	}

	update := WSGameUpdate{
		Type: "game_update",
		Game: ToGameJSON(game),
	}

	if data, err := json.Marshal(update); err == nil {
		hub.Broadcast(gameID, data)
	}
}

