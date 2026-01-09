package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/games", gamesHandler)
	mux.HandleFunc("/games/", gameHandler)
	mux.HandleFunc("/config/", configHandler)

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

// configHandler handles saving/loading background configs
func configHandler(w http.ResponseWriter, r *http.Request) {
	// Extract image name from path: /config/bg-09.png
	imageName := strings.TrimPrefix(r.URL.Path, "/config/")
	if imageName == "" {
		writeError(w, http.StatusBadRequest, "missing image name")
		return
	}

	configPath := filepath.Join("..", "web", imageName+".json")

	switch r.Method {
	case http.MethodGet:
		// Load config
		data, err := os.ReadFile(configPath)
		if err != nil {
			writeError(w, http.StatusNotFound, "config not found")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(data)

	case http.MethodPost:
		// Save config
		var config map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}

		data, err := json.MarshalIndent(config, "", "  ")
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to encode")
			return
		}

		if err := os.WriteFile(configPath, data, 0644); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save: "+err.Error())
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"saved"}`))

	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
