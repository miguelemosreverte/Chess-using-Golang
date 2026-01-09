package domain

// Board represents an immutable chess board.
// All operations return a new Board rather than mutating.
type Board struct {
	squares [8][8]*Piece
}

// NewBoard creates an empty board.
func NewBoard() Board {
	return Board{}
}

// NewBoardWithInitialSetup creates a board with the standard chess starting position.
func NewBoardWithInitialSetup() Board {
	b := NewBoard()

	// Place pawns
	for file := 0; file < 8; file++ {
		b = b.Set(NewPosition(file, 1), &Piece{Type: Pawn, Color: White})
		b = b.Set(NewPosition(file, 6), &Piece{Type: Pawn, Color: Black})
	}

	// Place other pieces
	backRank := []PieceType{Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook}
	for file, pieceType := range backRank {
		b = b.Set(NewPosition(file, 0), &Piece{Type: pieceType, Color: White})
		b = b.Set(NewPosition(file, 7), &Piece{Type: pieceType, Color: Black})
	}

	return b
}

// At returns the piece at the given position, or nil if empty.
func (b Board) At(pos Position) *Piece {
	if !pos.IsValid() {
		return nil
	}
	return b.squares[pos.File][pos.Rank]
}

// Set returns a new board with a piece placed at the given position.
// Pass nil to clear the square.
func (b Board) Set(pos Position, piece *Piece) Board {
	newBoard := b.copy()
	if pos.IsValid() {
		if piece == nil {
			newBoard.squares[pos.File][pos.Rank] = nil
		} else {
			// Create a copy of the piece to ensure immutability
			pieceCopy := *piece
			newBoard.squares[pos.File][pos.Rank] = &pieceCopy
		}
	}
	return newBoard
}

// Move returns a new board with a piece moved from one position to another.
// This is a basic move without validation.
func (b Board) Move(from, to Position) Board {
	piece := b.At(from)
	if piece == nil {
		return b
	}
	return b.Set(from, nil).Set(to, piece)
}

// FindKing returns the position of the king of the given color.
func (b Board) FindKing(color Color) (Position, bool) {
	for file := 0; file < 8; file++ {
		for rank := 0; rank < 8; rank++ {
			pos := NewPosition(file, rank)
			piece := b.At(pos)
			if piece != nil && piece.Type == King && piece.Color == color {
				return pos, true
			}
		}
	}
	return Position{}, false
}

// AllPieces returns all pieces of a given color with their positions.
func (b Board) AllPieces(color Color) []struct {
	Position Position
	Piece    Piece
} {
	var pieces []struct {
		Position Position
		Piece    Piece
	}
	for file := 0; file < 8; file++ {
		for rank := 0; rank < 8; rank++ {
			pos := NewPosition(file, rank)
			piece := b.At(pos)
			if piece != nil && piece.Color == color {
				pieces = append(pieces, struct {
					Position Position
					Piece    Piece
				}{pos, *piece})
			}
		}
	}
	return pieces
}

// IsEmpty returns true if the given position has no piece.
func (b Board) IsEmpty(pos Position) bool {
	return b.At(pos) == nil
}

// HasPiece returns true if the given position has a piece of the given color.
func (b Board) HasPiece(pos Position, color Color) bool {
	piece := b.At(pos)
	return piece != nil && piece.Color == color
}

// HasEnemy returns true if the given position has an enemy piece.
func (b Board) HasEnemy(pos Position, color Color) bool {
	piece := b.At(pos)
	return piece != nil && piece.Color != color
}

// copy creates a deep copy of the board.
func (b Board) copy() Board {
	newBoard := Board{}
	for file := 0; file < 8; file++ {
		for rank := 0; rank < 8; rank++ {
			if b.squares[file][rank] != nil {
				piece := *b.squares[file][rank]
				newBoard.squares[file][rank] = &piece
			}
		}
	}
	return newBoard
}

// ToMap returns the board as a map from position notation to piece.
// Useful for JSON serialization.
func (b Board) ToMap() map[string]Piece {
	result := make(map[string]Piece)
	for file := 0; file < 8; file++ {
		for rank := 0; rank < 8; rank++ {
			pos := NewPosition(file, rank)
			piece := b.At(pos)
			if piece != nil {
				result[pos.String()] = *piece
			}
		}
	}
	return result
}
