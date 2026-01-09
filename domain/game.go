package domain

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
)

// GameStatus represents the current state of the game.
type GameStatus int

const (
	Ongoing GameStatus = iota
	Check
	Checkmate
	Stalemate
	Draw
)

// String returns the status name.
func (s GameStatus) String() string {
	names := []string{"ongoing", "check", "checkmate", "stalemate", "draw"}
	return names[s]
}

// UndoRequest represents a pending undo request.
type UndoRequest struct {
	RequestedBy Color
}

// Game represents the complete state of a chess game.
// All operations return a new Game rather than mutating.
type Game struct {
	ID              string
	Board           Board
	Turn            Color
	Status          GameStatus
	MoveHistory     []Move
	CastlingRights  CastlingRights
	EnPassantTarget EnPassantTarget
	UndoRequest     *UndoRequest
}

// NewGame creates a new game with the standard starting position.
func NewGame() Game {
	return Game{
		ID:              generateID(),
		Board:           NewBoardWithInitialSetup(),
		Turn:            White,
		Status:          Ongoing,
		MoveHistory:     []Move{},
		CastlingRights:  NewCastlingRights(),
		EnPassantTarget: NoEnPassant(),
		UndoRequest:     nil,
	}
}

// NewGameWithID creates a new game with a specific ID.
func NewGameWithID(id string) Game {
	game := NewGame()
	game.ID = id
	return game
}

// ApplyMove attempts to apply a move to the game.
// Returns the new game state or an error if the move is illegal.
func ApplyMove(game Game, move Move) (Game, error) {
	if game.Status == Checkmate || game.Status == Stalemate || game.Status == Draw {
		return game, errors.New("game is already over")
	}

	piece := game.Board.At(move.From)
	if piece == nil {
		return game, errors.New("no piece at source position")
	}

	if piece.Color != game.Turn {
		return game, errors.New("not your turn")
	}

	// Check if the move is legal
	legalMoves := GetLegalMovesWithSpecial(game, move.From)
	isLegal := false
	for _, lm := range legalMoves {
		if lm.From.Equals(move.From) && lm.To.Equals(move.To) {
			isLegal = true
			break
		}
	}

	if !isLegal {
		return game, errors.New("illegal move")
	}

	// Apply the move based on type
	var newBoard Board
	promotionPiece := move.Promotion
	if promotionPiece == 0 && IsPromotionMove(move, *piece) {
		// Default to Queen if not specified
		promotionPiece = Queen
	}

	if IsCastlingMove(move, *piece) {
		newBoard = ApplyCastling(game.Board, move, game.Turn)
	} else if IsEnPassantCapture(game.Board, move, *piece, game.EnPassantTarget) {
		newBoard = ApplyEnPassant(game.Board, move, game.Turn)
	} else if IsPromotionMove(move, *piece) {
		newBoard = ApplyPromotion(game.Board, move, game.Turn, promotionPiece)
	} else {
		newBoard = game.Board.Move(move.From, move.To)
	}

	// Update castling rights
	newCastlingRights := game.CastlingRights.UpdateAfterMove(move.From, move.To, *piece)

	// Calculate en passant target for next turn
	newEnPassant := CalculateEnPassantTarget(move, *piece)

	nextTurn := game.Turn.Opponent()

	// Determine new status (need to pass special move info)
	newStatus := determineStatusWithSpecial(newBoard, nextTurn, newCastlingRights, newEnPassant)

	// Create new game state
	newHistory := make([]Move, len(game.MoveHistory)+1)
	copy(newHistory, game.MoveHistory)
	// Store the actual promotion piece used
	finalMove := move
	if promotionPiece != 0 {
		finalMove.Promotion = promotionPiece
	}
	newHistory[len(game.MoveHistory)] = finalMove

	return Game{
		ID:              game.ID,
		Board:           newBoard,
		Turn:            nextTurn,
		Status:          newStatus,
		MoveHistory:     newHistory,
		CastlingRights:  newCastlingRights,
		EnPassantTarget: newEnPassant,
		UndoRequest:     nil, // Clear any undo request after a move
	}, nil
}

// GetLegalMoves returns all legal moves for a piece at the given position.
func GetLegalMoves(game Game, pos Position) []Move {
	return GetLegalMovesWithSpecial(game, pos)
}

// GetLegalMovesWithSpecial returns legal moves including castling and en passant.
func GetLegalMovesWithSpecial(game Game, pos Position) []Move {
	piece := game.Board.At(pos)
	if piece == nil || piece.Color != game.Turn {
		return nil
	}

	// Get basic legal moves
	moves := LegalMoves(game.Board, pos, game.Turn)

	// Add castling moves if this is the king
	if piece.Type == King {
		castlingMoves := CastlingMoves(game.Board, game.CastlingRights, game.Turn)
		for _, cm := range castlingMoves {
			if cm.From.Equals(pos) {
				moves = append(moves, cm)
			}
		}
	}

	// Add en passant moves if this is a pawn (must also filter for check)
	if piece.Type == Pawn {
		epMoves := EnPassantMoves(game.Board, pos, game.Turn, game.EnPassantTarget)
		for _, epMove := range epMoves {
			// Simulate the en passant capture
			newBoard := ApplyEnPassant(game.Board, epMove, game.Turn)
			if !IsInCheck(newBoard, game.Turn) {
				moves = append(moves, epMove)
			}
		}
	}

	return moves
}

// GetAllLegalMoves returns all legal moves for the current player.
func GetAllLegalMoves(game Game) []Move {
	return AllLegalMovesWithSpecial(game)
}

// AllLegalMovesWithSpecial returns all legal moves including special moves.
func AllLegalMovesWithSpecial(game Game) []Move {
	var moves []Move
	pieces := game.Board.AllPieces(game.Turn)

	for _, p := range pieces {
		pieceMoves := GetLegalMovesWithSpecial(game, p.Position)
		moves = append(moves, pieceMoves...)
	}

	return moves
}

// determineStatusWithSpecial checks the game status after a move, considering special moves.
func determineStatusWithSpecial(board Board, turn Color, castling CastlingRights, enPassant EnPassantTarget) GameStatus {
	inCheck := IsInCheck(board, turn)

	// Create a temporary game to check for legal moves
	tempGame := Game{
		Board:           board,
		Turn:            turn,
		CastlingRights:  castling,
		EnPassantTarget: enPassant,
	}
	hasMoves := len(AllLegalMovesWithSpecial(tempGame)) > 0

	if !hasMoves {
		if inCheck {
			return Checkmate
		}
		return Stalemate
	}

	if inCheck {
		return Check
	}

	return Ongoing
}

// determineStatus checks the game status after a move.
func determineStatus(board Board, turn Color) GameStatus {
	inCheck := IsInCheck(board, turn)
	hasMoves := len(AllLegalMoves(board, turn)) > 0

	if !hasMoves {
		if inCheck {
			return Checkmate
		}
		return Stalemate
	}

	if inCheck {
		return Check
	}

	return Ongoing
}

// RequestUndo creates an undo request for the game.
func RequestUndo(game Game, requestor Color) Game {
	newGame := game
	newGame.UndoRequest = &UndoRequest{RequestedBy: requestor}
	return newGame
}

// AcceptUndo accepts a pending undo request and undoes the last move.
func AcceptUndo(game Game) (Game, error) {
	if game.UndoRequest == nil {
		return game, errors.New("no pending undo request")
	}

	if len(game.MoveHistory) == 0 {
		return game, errors.New("no moves to undo")
	}

	// Replay all moves except the last one to reconstruct the game state
	newGame := NewGameWithID(game.ID)

	for i := 0; i < len(game.MoveHistory)-1; i++ {
		var err error
		newGame, err = ApplyMove(newGame, game.MoveHistory[i])
		if err != nil {
			return game, errors.New("failed to reconstruct game state")
		}
	}

	return newGame, nil
}

// RejectUndo rejects a pending undo request.
func RejectUndo(game Game) Game {
	newGame := game
	newGame.UndoRequest = nil
	return newGame
}

// generateID creates a random game ID.
func generateID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
