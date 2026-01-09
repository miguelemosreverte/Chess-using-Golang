package domain

import "fmt"

// Move represents a chess move from one position to another.
type Move struct {
	From      Position
	To        Position
	Promotion PieceType // For pawn promotion (0 means no promotion)
}

// NewMove creates a simple move.
func NewMove(from, to Position) Move {
	return Move{From: from, To: to}
}

// NewMoveFromNotation creates a move from algebraic notation like "e2", "e4".
func NewMoveFromNotation(from, to string) (Move, error) {
	fromPos, err := ParsePosition(from)
	if err != nil {
		return Move{}, fmt.Errorf("invalid from position: %w", err)
	}
	toPos, err := ParsePosition(to)
	if err != nil {
		return Move{}, fmt.Errorf("invalid to position: %w", err)
	}
	return NewMove(fromPos, toPos), nil
}

// WithPromotion returns a new move with a promotion piece set.
func (m Move) WithPromotion(pieceType PieceType) Move {
	return Move{From: m.From, To: m.To, Promotion: pieceType}
}

// String returns the move in notation like "e2-e4".
func (m Move) String() string {
	return m.From.String() + "-" + m.To.String()
}

// Equals returns true if two moves are the same.
func (m Move) Equals(other Move) bool {
	return m.From.Equals(other.From) && m.To.Equals(other.To) && m.Promotion == other.Promotion
}
