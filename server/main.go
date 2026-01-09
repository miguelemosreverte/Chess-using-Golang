package main

import (
	"fmt"
	"log"
	"net/http"
	"strings"
)

func main() {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/games", gamesHandler)
	mux.HandleFunc("/games/", gameHandler)

	// Serve static files from web directory
	fs := http.FileServer(http.Dir("../web"))
	mux.Handle("/", fs)

	addr := ":8080"
	fmt.Printf("Chess server running at http://localhost%s\n", addr)
	fmt.Println("API endpoints:")
	fmt.Println("  POST /games              - Create a new game")
	fmt.Println("  GET  /games/{id}         - Get game state")
	fmt.Println("  GET  /games/{id}/moves   - Get legal moves")
	fmt.Println("  POST /games/{id}/moves   - Make a move")
	fmt.Println("  POST /games/{id}/undo/request - Request undo")
	fmt.Println("  POST /games/{id}/undo/accept  - Accept undo")
	fmt.Println("  POST /games/{id}/undo/reject  - Reject undo")
	fmt.Println()

	log.Fatal(http.ListenAndServe(addr, corsMiddleware(mux)))
}

// gamesHandler routes requests to /games
func gamesHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		CreateGame(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// gameHandler routes requests to /games/{id} and /games/{id}/moves
func gameHandler(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Handle undo endpoints
	if strings.Contains(path, "/undo/") {
		if strings.HasSuffix(path, "/undo/request") {
			RequestUndoHandler(w, r)
		} else if strings.HasSuffix(path, "/undo/accept") {
			AcceptUndoHandler(w, r)
		} else if strings.HasSuffix(path, "/undo/reject") {
			RejectUndoHandler(w, r)
		} else {
			writeError(w, http.StatusNotFound, "not found")
		}
		return
	}

	if strings.HasSuffix(path, "/moves") {
		switch r.Method {
		case http.MethodGet:
			GetMoves(w, r)
		case http.MethodPost:
			MakeMove(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	} else {
		GetGame(w, r)
	}
}

// corsMiddleware adds CORS headers for local development.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
