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

	// Root handler - serves book page or game page
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Root path: serve index.html (book will be shown by JS)
		if path == "/" {
			http.ServeFile(w, r, "../web/index.html")
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
// Supports paths like:
// - /config/basic-household/bg-01.png (new chapter-based path)
// - /config/chapters.json (master config)
func configHandler(w http.ResponseWriter, r *http.Request) {
	// Extract path from URL: /config/basic-household/bg-01.png
	path := strings.TrimPrefix(r.URL.Path, "/config/")
	if path == "" {
		writeError(w, http.StatusBadRequest, "missing path")
		return
	}

	var configPath string
	if path == "chapters.json" {
		// Master chapters config
		configPath = filepath.Join("..", "web", "chapters.json")
	} else if strings.Contains(path, "/") {
		// Chapter-based path: basic-household/bg-01.png
		parts := strings.Split(path, "/")
		if len(parts) == 2 {
			chapterID := parts[0]
			imageName := parts[1]
			configPath = filepath.Join("..", "web", "chapters", chapterID, "board", imageName+".json")
		} else {
			writeError(w, http.StatusBadRequest, "invalid path format")
			return
		}
	} else {
		// Legacy path for backwards compatibility: bg-01.png
		// Check if it exists in any chapter's board folder
		configPath = filepath.Join("..", "web", "chapters", "basic-household", "board", path+".json")
	}

	switch r.Method {
	case http.MethodGet:
		// Load config
		data, err := os.ReadFile(configPath)
		if err != nil {
			log.Printf("Config not found at path: %s (error: %v)", configPath, err)
			writeError(w, http.StatusNotFound, "config not found: "+configPath)
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
