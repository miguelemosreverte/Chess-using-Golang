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

	// Serve index.html for root
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "index.html")
			return
		}
		// Proxy API requests to the main chess server
		if len(r.URL.Path) >= 5 && r.URL.Path[:5] == "/game" {
			proxyToAPI(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})

	// Proxy /games requests to main API server
	http.HandleFunc("/games", proxyToAPI)
	http.HandleFunc("/games/", proxyToAPI)

	port := 8082
	fmt.Printf("Classic Wood Chess UI server starting on http://localhost:%d\n", port)
	fmt.Println("Proxying API requests to http://localhost:8080")
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", port), nil))
}

func proxyToAPI(w http.ResponseWriter, r *http.Request) {
	target, _ := url.Parse("http://localhost:8080")
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ServeHTTP(w, r)
}
