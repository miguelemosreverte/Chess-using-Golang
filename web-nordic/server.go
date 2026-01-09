package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

func main() {
	// Serve static files from current directory
	fs := http.FileServer(http.Dir("."))
	http.Handle("/style.css", fs)
	http.Handle("/app.js", fs)
	http.Handle("/index.html", fs)

	// Serve index.html for root path
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "index.html")
			return
		}
		// Proxy API requests to the main chess server
		if len(r.URL.Path) > 1 {
			proxy := httputil.NewSingleHostReverseProxy(&url.URL{
				Scheme: "http",
				Host:   "localhost:8080",
			})
			proxy.ServeHTTP(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})

	// Proxy /games requests to main chess server
	http.HandleFunc("/games", proxyToChessServer)
	http.HandleFunc("/games/", proxyToChessServer)

	port := ":8085"
	fmt.Printf("Nordic Zen Chess UI running at http://localhost%s\n", port)
	log.Fatal(http.ListenAndServe(port, nil))
}

func proxyToChessServer(w http.ResponseWriter, r *http.Request) {
	target := &url.URL{
		Scheme: "http",
		Host:   "localhost:8080",
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ServeHTTP(w, r)
}
