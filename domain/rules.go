package domain

// PseudoLegalMoves returns all moves a piece could make, ignoring check.
// These are "pseudo-legal" because they don't account for leaving the king in check.
func PseudoLegalMoves(board Board, pos Position) []Move {
	piece := board.At(pos)
	if piece == nil {
		return nil
	}

	switch piece.Type {
	case Pawn:
		return pawnMoves(board, pos, piece.Color)
	case Knight:
		return knightMoves(board, pos, piece.Color)
	case Bishop:
		return bishopMoves(board, pos, piece.Color)
	case Rook:
		return rookMoves(board, pos, piece.Color)
	case Queen:
		return queenMoves(board, pos, piece.Color)
	case King:
		return kingMoves(board, pos, piece.Color)
	}
	return nil
}

// LegalMoves returns all legal moves for a piece, accounting for check.
func LegalMoves(board Board, pos Position, turn Color) []Move {
	piece := board.At(pos)
	if piece == nil || piece.Color != turn {
		return nil
	}

	pseudoMoves := PseudoLegalMoves(board, pos)
	var legal []Move

	for _, move := range pseudoMoves {
		newBoard := board.Move(move.From, move.To)
		if !IsInCheck(newBoard, turn) {
			legal = append(legal, move)
		}
	}

	return legal
}

// AllLegalMoves returns all legal moves for a player.
func AllLegalMoves(board Board, turn Color) []Move {
	var moves []Move
	pieces := board.AllPieces(turn)

	for _, p := range pieces {
		pieceMoves := LegalMoves(board, p.Position, turn)
		moves = append(moves, pieceMoves...)
	}

	return moves
}

// IsInCheck returns true if the given color's king is in check.
func IsInCheck(board Board, color Color) bool {
	kingPos, found := board.FindKing(color)
	if !found {
		return false
	}

	return isSquareAttacked(board, kingPos, color.Opponent())
}

// IsCheckmate returns true if the given color is in checkmate.
func IsCheckmate(board Board, turn Color) bool {
	if !IsInCheck(board, turn) {
		return false
	}
	return len(AllLegalMoves(board, turn)) == 0
}

// IsStalemate returns true if the given color is in stalemate.
func IsStalemate(board Board, turn Color) bool {
	if IsInCheck(board, turn) {
		return false
	}
	return len(AllLegalMoves(board, turn)) == 0
}

// isSquareAttacked returns true if any piece of the attacker color attacks the square.
func isSquareAttacked(board Board, target Position, attacker Color) bool {
	pieces := board.AllPieces(attacker)

	for _, p := range pieces {
		moves := PseudoLegalMoves(board, p.Position)
		for _, move := range moves {
			if move.To.Equals(target) {
				return true
			}
		}
	}

	return false
}

// pawnMoves generates all pseudo-legal pawn moves.
func pawnMoves(board Board, pos Position, color Color) []Move {
	var moves []Move
	dir := color.Direction()

	// Single push
	oneStep, valid := pos.Offset(0, dir)
	if valid && board.IsEmpty(oneStep) {
		moves = append(moves, NewMove(pos, oneStep))

		// Double push from starting position
		if pos.Rank == color.HomeRank() {
			twoStep, valid := pos.Offset(0, 2*dir)
			if valid && board.IsEmpty(twoStep) {
				moves = append(moves, NewMove(pos, twoStep))
			}
		}
	}

	// Captures (diagonal)
	for _, fileDelta := range []int{-1, 1} {
		capturePos, valid := pos.Offset(fileDelta, dir)
		if valid && board.HasEnemy(capturePos, color) {
			moves = append(moves, NewMove(pos, capturePos))
		}
	}

	return moves
}

// knightMoves generates all pseudo-legal knight moves.
func knightMoves(board Board, pos Position, color Color) []Move {
	var moves []Move
	offsets := [][2]int{
		{-2, -1}, {-2, 1}, {-1, -2}, {-1, 2},
		{1, -2}, {1, 2}, {2, -1}, {2, 1},
	}

	for _, offset := range offsets {
		newPos, valid := pos.Offset(offset[0], offset[1])
		if valid && !board.HasPiece(newPos, color) {
			moves = append(moves, NewMove(pos, newPos))
		}
	}

	return moves
}

// bishopMoves generates all pseudo-legal bishop moves.
func bishopMoves(board Board, pos Position, color Color) []Move {
	directions := [][2]int{{-1, -1}, {-1, 1}, {1, -1}, {1, 1}}
	return slidingMoves(board, pos, color, directions)
}

// rookMoves generates all pseudo-legal rook moves.
func rookMoves(board Board, pos Position, color Color) []Move {
	directions := [][2]int{{0, -1}, {0, 1}, {-1, 0}, {1, 0}}
	return slidingMoves(board, pos, color, directions)
}

// queenMoves generates all pseudo-legal queen moves.
func queenMoves(board Board, pos Position, color Color) []Move {
	directions := [][2]int{
		{-1, -1}, {-1, 0}, {-1, 1},
		{0, -1}, {0, 1},
		{1, -1}, {1, 0}, {1, 1},
	}
	return slidingMoves(board, pos, color, directions)
}

// kingMoves generates all pseudo-legal king moves.
func kingMoves(board Board, pos Position, color Color) []Move {
	var moves []Move
	directions := [][2]int{
		{-1, -1}, {-1, 0}, {-1, 1},
		{0, -1}, {0, 1},
		{1, -1}, {1, 0}, {1, 1},
	}

	for _, dir := range directions {
		newPos, valid := pos.Offset(dir[0], dir[1])
		if valid && !board.HasPiece(newPos, color) {
			moves = append(moves, NewMove(pos, newPos))
		}
	}

	return moves
}

// slidingMoves generates moves for sliding pieces (bishop, rook, queen).
func slidingMoves(board Board, pos Position, color Color, directions [][2]int) []Move {
	var moves []Move

	for _, dir := range directions {
		current := pos
		for {
			next, valid := current.Offset(dir[0], dir[1])
			if !valid {
				break
			}

			if board.IsEmpty(next) {
				moves = append(moves, NewMove(pos, next))
				current = next
			} else if board.HasEnemy(next, color) {
				moves = append(moves, NewMove(pos, next))
				break
			} else {
				break
			}
		}
	}

	return moves
}
