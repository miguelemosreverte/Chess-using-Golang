package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	// Get the directory where the server.go file is located
	execPath, err := os.Executable()
	if err != nil {
		// Fallback to current directory
		execPath, _ = os.Getwd()
	}
	webDir := filepath.Dir(execPath)

	// If running with 'go run', use the source file's directory
	if len(os.Args) > 0 {
		if sourceDir := filepath.Dir(os.Args[0]); sourceDir != "." {
			webDir = sourceDir
		}
	}

	// Try current working directory if files not found
	if _, err := os.Stat(filepath.Join(webDir, "index.html")); os.IsNotExist(err) {
		webDir, _ = os.Getwd()
	}

	// Create file server
	fs := http.FileServer(http.Dir(webDir))
	http.Handle("/", fs)

	port := "8084"
	fmt.Printf("Modern Flat Chess UI Server\n")
	fmt.Printf("===========================\n")
	fmt.Printf("Serving files from: %s\n", webDir)
	fmt.Printf("Server running at: http://localhost:%s\n", port)
	fmt.Printf("Press Ctrl+C to stop\n")

	log.Fatal(http.ListenAndServe(":"+port, nil))
}
