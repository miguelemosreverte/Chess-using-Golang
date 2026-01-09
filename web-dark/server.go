package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	// Get the directory where this server file is located
	execPath, err := os.Executable()
	if err != nil {
		// Fallback to current working directory
		execPath, _ = os.Getwd()
	}

	// Try to find the web-dark directory
	dir := filepath.Dir(execPath)

	// Check if we're running with 'go run' (in which case use current dir)
	if _, err := os.Stat(filepath.Join(dir, "index.html")); os.IsNotExist(err) {
		// Try current working directory
		cwd, _ := os.Getwd()
		if _, err := os.Stat(filepath.Join(cwd, "index.html")); err == nil {
			dir = cwd
		} else {
			// Use the directory containing this source file
			dir = "/Users/miguel_lemos/Desktop/learning-go/chess/web-dark"
		}
	}

	// Create file server
	fs := http.FileServer(http.Dir(dir))
	http.Handle("/", fs)

	port := ":8083"
	fmt.Println("========================================")
	fmt.Println("  Dark Elegant Chess UI")
	fmt.Println("  A sophisticated, luxurious design")
	fmt.Println("========================================")
	fmt.Printf("Serving files from: %s\n", dir)
	fmt.Printf("Server running at: http://localhost%s\n", port)
	fmt.Println("Press Ctrl+C to stop")
	fmt.Println()

	log.Fatal(http.ListenAndServe(port, nil))
}
