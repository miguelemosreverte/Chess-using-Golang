package domain

// CastlingRights tracks whether castling is still possible.
type CastlingRights struct {
	WhiteKingside  bool
	WhiteQueenside bool
	BlackKingside  bool
	BlackQueenside bool
}

// NewCastlingRights returns initial castling rights (all true).
func NewCastlingRights() CastlingRights {
	return CastlingRights{
		WhiteKingside:  true,
		WhiteQueenside: true,
		BlackKingside:  true,
		BlackQueenside: true,
	}
}

// UpdateAfterMove returns new castling rights after a move.
func (cr CastlingRights) UpdateAfterMove(from, to Position, piece Piece) CastlingRights {
	newRights := cr

	// If king moves, lose both castling rights
	if piece.Type == King {
		if piece.Color == White {
			newRights.WhiteKingside = false
			newRights.WhiteQueenside = false
		} else {
			newRights.BlackKingside = false
			newRights.BlackQueenside = false
		}
	}

	// If rook moves from its starting square, lose that side's castling
	if piece.Type == Rook {
		if piece.Color == White {
			if from.Equals(NewPosition(0, 0)) { // a1
				newRights.WhiteQueenside = false
			} else if from.Equals(NewPosition(7, 0)) { // h1
				newRights.WhiteKingside = false
			}
		} else {
			if from.Equals(NewPosition(0, 7)) { // a8
				newRights.BlackQueenside = false
			} else if from.Equals(NewPosition(7, 7)) { // h8
				newRights.BlackKingside = false
			}
		}
	}

	// If a rook is captured, lose that castling right
	if to.Equals(NewPosition(0, 0)) {
		newRights.WhiteQueenside = false
	} else if to.Equals(NewPosition(7, 0)) {
		newRights.WhiteKingside = false
	} else if to.Equals(NewPosition(0, 7)) {
		newRights.BlackQueenside = false
	} else if to.Equals(NewPosition(7, 7)) {
		newRights.BlackKingside = false
	}

	return newRights
}

// CanCastleKingside checks if kingside castling is possible.
func CanCastleKingside(board Board, rights CastlingRights, color Color) bool {
	if color == White && !rights.WhiteKingside {
		return false
	}
	if color == Black && !rights.BlackKingside {
		return false
	}

	rank := 0
	if color == Black {
		rank = 7
	}

	// Check squares between king and rook are empty
	f1 := NewPosition(5, rank) // f1/f8
	g1 := NewPosition(6, rank) // g1/g8

	if !board.IsEmpty(f1) || !board.IsEmpty(g1) {
		return false
	}

	// King cannot be in check
	kingPos := NewPosition(4, rank) // e1/e8
	if isSquareAttacked(board, kingPos, color.Opponent()) {
		return false
	}

	// King cannot pass through check
	if isSquareAttacked(board, f1, color.Opponent()) {
		return false
	}

	// King cannot end up in check
	if isSquareAttacked(board, g1, color.Opponent()) {
		return false
	}

	return true
}

// CanCastleQueenside checks if queenside castling is possible.
func CanCastleQueenside(board Board, rights CastlingRights, color Color) bool {
	if color == White && !rights.WhiteQueenside {
		return false
	}
	if color == Black && !rights.BlackQueenside {
		return false
	}

	rank := 0
	if color == Black {
		rank = 7
	}

	// Check squares between king and rook are empty
	b1 := NewPosition(1, rank) // b1/b8
	c1 := NewPosition(2, rank) // c1/c8
	d1 := NewPosition(3, rank) // d1/d8

	if !board.IsEmpty(b1) || !board.IsEmpty(c1) || !board.IsEmpty(d1) {
		return false
	}

	// King cannot be in check
	kingPos := NewPosition(4, rank) // e1/e8
	if isSquareAttacked(board, kingPos, color.Opponent()) {
		return false
	}

	// King cannot pass through check (d1/d8 and c1/c8)
	if isSquareAttacked(board, d1, color.Opponent()) {
		return false
	}
	if isSquareAttacked(board, c1, color.Opponent()) {
		return false
	}

	return true
}

// CastlingMoves returns available castling moves for a king.
func CastlingMoves(board Board, rights CastlingRights, color Color) []Move {
	var moves []Move
	rank := 0
	if color == Black {
		rank = 7
	}

	kingPos := NewPosition(4, rank)

	if CanCastleKingside(board, rights, color) {
		moves = append(moves, NewMove(kingPos, NewPosition(6, rank))) // e1-g1 or e8-g8
	}

	if CanCastleQueenside(board, rights, color) {
		moves = append(moves, NewMove(kingPos, NewPosition(2, rank))) // e1-c1 or e8-c8
	}

	return moves
}

// IsCastlingMove checks if a move is a castling move.
func IsCastlingMove(move Move, piece Piece) bool {
	if piece.Type != King {
		return false
	}
	// Castling is when king moves 2 squares horizontally
	fileDiff := move.To.File - move.From.File
	return fileDiff == 2 || fileDiff == -2
}

// ApplyCastling returns the board after applying a castling move.
func ApplyCastling(board Board, move Move, color Color) Board {
	// Move the king
	newBoard := board.Move(move.From, move.To)

	// Move the rook
	rank := move.From.Rank
	if move.To.File == 6 { // Kingside
		rookFrom := NewPosition(7, rank)
		rookTo := NewPosition(5, rank)
		newBoard = newBoard.Move(rookFrom, rookTo)
	} else { // Queenside
		rookFrom := NewPosition(0, rank)
		rookTo := NewPosition(3, rank)
		newBoard = newBoard.Move(rookFrom, rookTo)
	}

	return newBoard
}

// EnPassantTarget represents the square where en passant capture is possible.
type EnPassantTarget struct {
	Position Position
	Valid    bool
}

// NoEnPassant returns an empty en passant target.
func NoEnPassant() EnPassantTarget {
	return EnPassantTarget{Valid: false}
}

// NewEnPassantTarget creates a valid en passant target.
func NewEnPassantTarget(pos Position) EnPassantTarget {
	return EnPassantTarget{Position: pos, Valid: true}
}

// CalculateEnPassantTarget determines the en passant target after a pawn move.
func CalculateEnPassantTarget(move Move, piece Piece) EnPassantTarget {
	if piece.Type != Pawn {
		return NoEnPassant()
	}

	// Check if pawn moved 2 squares
	rankDiff := move.To.Rank - move.From.Rank
	if rankDiff != 2 && rankDiff != -2 {
		return NoEnPassant()
	}

	// The en passant target is the square the pawn passed over
	targetRank := (move.From.Rank + move.To.Rank) / 2
	return NewEnPassantTarget(NewPosition(move.To.File, targetRank))
}

// EnPassantMoves returns en passant capture moves for a pawn.
func EnPassantMoves(board Board, pos Position, color Color, epTarget EnPassantTarget) []Move {
	if !epTarget.Valid {
		return nil
	}

	var moves []Move
	piece := board.At(pos)
	if piece == nil || piece.Type != Pawn || piece.Color != color {
		return nil
	}

	dir := color.Direction()

	// Check if this pawn can capture en passant
	for _, fileDelta := range []int{-1, 1} {
		capturePos, valid := pos.Offset(fileDelta, dir)
		if valid && capturePos.Equals(epTarget.Position) {
			moves = append(moves, NewMove(pos, capturePos))
		}
	}

	return moves
}

// IsEnPassantCapture checks if a pawn move is an en passant capture.
func IsEnPassantCapture(board Board, move Move, piece Piece, epTarget EnPassantTarget) bool {
	if piece.Type != Pawn {
		return false
	}
	if !epTarget.Valid {
		return false
	}
	return move.To.Equals(epTarget.Position)
}

// ApplyEnPassant returns the board after an en passant capture.
func ApplyEnPassant(board Board, move Move, color Color) Board {
	// Move the pawn
	newBoard := board.Move(move.From, move.To)

	// Remove the captured pawn (it's on the same file as the destination, but one rank back)
	capturedRank := move.To.Rank - color.Direction()
	capturedPos := NewPosition(move.To.File, capturedRank)
	newBoard = newBoard.Set(capturedPos, nil)

	return newBoard
}

// IsPromotionMove checks if a pawn move results in promotion.
func IsPromotionMove(move Move, piece Piece) bool {
	if piece.Type != Pawn {
		return false
	}
	// White pawn reaching rank 8 (index 7) or black pawn reaching rank 1 (index 0)
	if piece.Color == White && move.To.Rank == 7 {
		return true
	}
	if piece.Color == Black && move.To.Rank == 0 {
		return true
	}
	return false
}

// ApplyPromotion returns the board after pawn promotion.
func ApplyPromotion(board Board, move Move, color Color, promoteTo PieceType) Board {
	// Move the pawn
	newBoard := board.Move(move.From, move.To)

	// Replace with promoted piece
	newBoard = newBoard.Set(move.To, &Piece{Type: promoteTo, Color: color})

	return newBoard
}
