// Minimalist Chess UI Server - Port 8081
package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
)

func main() {
	// Get the directory where the server executable is located
	execPath, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	webDir := filepath.Dir(execPath)

	// If running with 'go run', use the current directory
	if _, err := os.Stat(filepath.Join(webDir, "index.html")); os.IsNotExist(err) {
		webDir, _ = os.Getwd()
	}

	// Create reverse proxy for API calls to main server on port 8080
	apiURL, _ := url.Parse("http://localhost:8080")
	proxy := httputil.NewSingleHostReverseProxy(apiURL)

	// Handle API routes - proxy to main server
	http.HandleFunc("/games", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})
	http.HandleFunc("/games/", func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})

	// Serve static files for UI
	fs := http.FileServer(http.Dir(webDir))
	http.Handle("/", fs)

	port := "8081"
	fmt.Printf("Minimalist Chess UI server starting on http://localhost:%s\n", port)
	fmt.Println("(Make sure main chess server is running on port 8080)")

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
