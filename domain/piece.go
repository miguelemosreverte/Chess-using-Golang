package domain

// Color represents the color of a piece or player.
type Color int

const (
	White Color = iota
	Black
)

// String returns the color name.
func (c Color) String() string {
	if c == White {
		return "white"
	}
	return "black"
}

// Opponent returns the opposite color.
func (c Color) Opponent() Color {
	if c == White {
		return Black
	}
	return White
}

// Direction returns the forward direction for pawns (1 for white, -1 for black).
func (c Color) Direction() int {
	if c == White {
		return 1
	}
	return -1
}

// HomeRank returns the starting rank for pawns (1 for white, 6 for black).
func (c Color) HomeRank() int {
	if c == White {
		return 1
	}
	return 6
}

// PieceType represents the type of chess piece.
type PieceType int

const (
	Pawn PieceType = iota
	Knight
	Bishop
	Rook
	Queen
	King
)

// String returns the piece type name.
func (pt PieceType) String() string {
	names := []string{"pawn", "knight", "bishop", "rook", "queen", "king"}
	return names[pt]
}

// Piece represents a chess piece with a type and color.
type Piece struct {
	Type  PieceType
	Color Color
}

// NewPiece creates a new piece.
func NewPiece(pieceType PieceType, color Color) Piece {
	return Piece{Type: pieceType, Color: color}
}

// String returns a human-readable representation.
func (p Piece) String() string {
	return p.Color.String() + " " + p.Type.String()
}

// Symbol returns the Unicode chess symbol for the piece.
func (p Piece) Symbol() string {
	symbols := map[Color]map[PieceType]string{
		White: {
			King:   "♔",
			Queen:  "♕",
			Rook:   "♖",
			Bishop: "♗",
			Knight: "♘",
			Pawn:   "♙",
		},
		Black: {
			King:   "♚",
			Queen:  "♛",
			Rook:   "♜",
			Bishop: "♝",
			Knight: "♞",
			Pawn:   "♟",
		},
	}
	return symbols[p.Color][p.Type]
}
