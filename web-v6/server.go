package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

func main() {
	// Serve static files from current directory
	fs := http.FileServer(http.Dir("."))

	// Create reverse proxy for /games endpoint
	backendURL, err := url.Parse("http://localhost:8080")
	if err != nil {
		log.Fatal("Error parsing backend URL:", err)
	}
	proxy := httputil.NewSingleHostReverseProxy(backendURL)

	// Handle routes
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if len(r.URL.Path) >= 6 && r.URL.Path[:6] == "/games" {
			proxy.ServeHTTP(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})

	log.Println("Chess UI v6 (Thin Border Only) server starting on http://localhost:8086")
	log.Fatal(http.ListenAndServe(":8086", nil))
}
