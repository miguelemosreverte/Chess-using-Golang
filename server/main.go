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
	mux.HandleFunc("/api/games", gamesHandler)
	mux.HandleFunc("/api/games/", gameHandler)
	mux.HandleFunc("/config/", configHandler)

	// Static files
	fs := http.FileServer(http.Dir("../web"))

	// Root handler - creates game and redirects, or serves static files
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Root path: create new game and redirect
		if path == "/" {
			game := createNewGame()
			http.Redirect(w, r, "/"+game.ID, http.StatusFound)
			return
		}

		// Check if it's a game ID (16 hex chars)
		gameID := strings.TrimPrefix(path, "/")
		if len(gameID) == 16 && isHexString(gameID) {
			// Serve index.html for game URLs
			http.ServeFile(w, r, "../web/index.html")
			return
		}

		// Otherwise serve static files
		fs.ServeHTTP(w, r)
	})

	addr := ":8080"
	fmt.Printf("Chess server running at http://localhost%s\n", addr)
	fmt.Println("Visit http://localhost:8080 to start a new game")
	fmt.Println("Share the URL to invite another player")
	fmt.Println()

	log.Fatal(http.ListenAndServe(addr, corsMiddleware(mux)))
}

func isHexString(s string) bool {
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
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

// gameHandler routes requests to /api/games/{id} and sub-paths
func gameHandler(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Handle chat endpoints
	if strings.HasSuffix(path, "/chat") {
		switch r.Method {
		case http.MethodGet:
			GetChat(w, r)
		case http.MethodPost:
			PostChat(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

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
