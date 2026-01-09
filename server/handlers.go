package main

import (
	"chess/domain"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
)

// GameStore holds games in memory with thread-safe access.
type GameStore struct {
	mu    sync.RWMutex
	games map[string]domain.Game
}

// NewGameStore creates a new game store.
func NewGameStore() *GameStore {
	return &GameStore{
		games: make(map[string]domain.Game),
	}
}

// Get retrieves a game by ID.
func (s *GameStore) Get(id string) (domain.Game, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	game, ok := s.games[id]
	return game, ok
}

// Save stores a game.
func (s *GameStore) Save(game domain.Game) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.games[game.ID] = game
}

var store = NewGameStore()

// ChatMessage represents a single chat message
type ChatMessage struct {
	Player  string `json:"player"`
	Message string `json:"message"`
	Time    int64  `json:"time"`
}

// ChatStore holds chat messages per game
type ChatStore struct {
	mu       sync.RWMutex
	messages map[string][]ChatMessage
}

func NewChatStore() *ChatStore {
	return &ChatStore{
		messages: make(map[string][]ChatMessage),
	}
}

func (c *ChatStore) GetMessages(gameID string) []ChatMessage {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.messages[gameID]
}

func (c *ChatStore) AddMessage(gameID string, msg ChatMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.messages[gameID] = append(c.messages[gameID], msg)
}

var chatStore = NewChatStore()

// createNewGame creates a new game and stores it (used by main for redirects)
func createNewGame() domain.Game {
	game := domain.NewGame()
	store.Save(game)
	return game
}

// CreateGame handles POST /games
func CreateGame(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	game := domain.NewGame()
	store.Save(game)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(ToGameJSON(game))
}

// GetGame handles GET /api/games/{id}
func GetGame(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := extractGameID(r.URL.Path, "/api/games/")
	if id == "" {
		writeError(w, http.StatusBadRequest, "missing game id")
		return
	}

	// Remove any trailing path segments (like /moves)
	if idx := strings.Index(id, "/"); idx != -1 {
		id = id[:idx]
	}

	game, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ToGameJSON(game))
}

// GetMoves handles GET /api/games/{id}/moves
func GetMoves(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := extractGameID(r.URL.Path, "/api/games/")
	id = strings.TrimSuffix(id, "/moves")

	game, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	// Check for optional "from" query parameter
	fromParam := r.URL.Query().Get("from")
	var moves []domain.Move

	if fromParam != "" {
		pos, err := domain.ParsePosition(fromParam)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid position: "+fromParam)
			return
		}
		moves = domain.GetLegalMoves(game, pos)
	} else {
		moves = domain.GetAllLegalMoves(game)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ToMovesResponseJSON(moves))
}

// MakeMove handles POST /api/games/{id}/moves
func MakeMove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := extractGameID(r.URL.Path, "/api/games/")
	id = strings.TrimSuffix(id, "/moves")

	game, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	var req MoveRequestJSON
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	move, err := domain.NewMoveFromNotation(req.From, req.To)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Handle promotion if specified
	if req.Promotion != "" {
		promotion := ParsePromotion(req.Promotion)
		if promotion != 0 {
			move = move.WithPromotion(promotion)
		}
	}

	newGame, err := domain.ApplyMove(game, move)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	store.Save(newGame)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ToGameJSON(newGame))
}

// RequestUndoHandler handles POST /games/{id}/undo/request
func RequestUndoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := extractUndoGameID(r.URL.Path)
	game, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	var req UndoRequestBodyJSON
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	color, valid := ParseColor(req.Color)
	if !valid {
		writeError(w, http.StatusBadRequest, "invalid color")
		return
	}

	newGame := domain.RequestUndo(game, color)
	store.Save(newGame)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ToGameJSON(newGame))
}

// AcceptUndoHandler handles POST /games/{id}/undo/accept
func AcceptUndoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := extractUndoGameID(r.URL.Path)
	game, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	newGame, err := domain.AcceptUndo(game)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	store.Save(newGame)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ToGameJSON(newGame))
}

// RejectUndoHandler handles POST /games/{id}/undo/reject
func RejectUndoHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := extractUndoGameID(r.URL.Path)
	game, ok := store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}

	newGame := domain.RejectUndo(game)
	store.Save(newGame)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ToGameJSON(newGame))
}

// extractGameID extracts the game ID from the URL path.
func extractGameID(path, prefix string) string {
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	return strings.TrimPrefix(path, prefix)
}

// extractUndoGameID extracts game ID from undo paths like /api/games/{id}/undo/request
func extractUndoGameID(path string) string {
	path = strings.TrimPrefix(path, "/api/games/")
	if idx := strings.Index(path, "/undo"); idx != -1 {
		return path[:idx]
	}
	return path
}

// GetChat handles GET /api/games/{id}/chat
func GetChat(w http.ResponseWriter, r *http.Request) {
	id := extractGameID(r.URL.Path, "/api/games/")
	id = strings.TrimSuffix(id, "/chat")

	messages := chatStore.GetMessages(id)
	if messages == nil {
		messages = []ChatMessage{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(messages)
}

// PostChat handles POST /api/games/{id}/chat
func PostChat(w http.ResponseWriter, r *http.Request) {
	id := extractGameID(r.URL.Path, "/api/games/")
	id = strings.TrimSuffix(id, "/chat")

	var msg ChatMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	chatStore.AddMessage(id, msg)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(ErrorJSON{Error: message})
}
