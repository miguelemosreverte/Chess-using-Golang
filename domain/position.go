package domain

import (
	"fmt"
)

// Position represents a square on the chess board.
// File is 0-7 (a-h), Rank is 0-7 (1-8).
type Position struct {
	File int
	Rank int
}

// NewPosition creates a position from file (0-7) and rank (0-7).
func NewPosition(file, rank int) Position {
	return Position{File: file, Rank: rank}
}

// ParsePosition parses algebraic notation like "e4" into a Position.
// Returns error if the notation is invalid.
func ParsePosition(notation string) (Position, error) {
	if len(notation) != 2 {
		return Position{}, fmt.Errorf("invalid position: %s", notation)
	}

	file := int(notation[0] - 'a')
	rank := int(notation[1] - '1')

	if !isValidCoord(file) || !isValidCoord(rank) {
		return Position{}, fmt.Errorf("invalid position: %s", notation)
	}

	return Position{File: file, Rank: rank}, nil
}

// String returns the algebraic notation of the position (e.g., "e4").
func (p Position) String() string {
	return fmt.Sprintf("%c%c", 'a'+p.File, '1'+p.Rank)
}

// IsValid returns true if the position is within the board bounds.
func (p Position) IsValid() bool {
	return isValidCoord(p.File) && isValidCoord(p.Rank)
}

// Offset returns a new position offset by the given file and rank deltas.
// Returns the new position and whether it's valid.
func (p Position) Offset(fileDelta, rankDelta int) (Position, bool) {
	newPos := Position{
		File: p.File + fileDelta,
		Rank: p.Rank + rankDelta,
	}
	return newPos, newPos.IsValid()
}

// Equals returns true if two positions are the same.
func (p Position) Equals(other Position) bool {
	return p.File == other.File && p.Rank == other.Rank
}

func isValidCoord(c int) bool {
	return c >= 0 && c < 8
}
