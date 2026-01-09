package main

import "chess/domain"

// PieceJSON is the JSON representation of a piece.
type PieceJSON struct {
	Type  string `json:"type"`
	Color string `json:"color"`
}

// MoveJSON is the JSON representation of a move.
type MoveJSON struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Promotion string `json:"promotion,omitempty"`
}

// GameJSON is the JSON representation of a game.
type GameJSON struct {
	ID          string               `json:"id"`
	Board       map[string]PieceJSON `json:"board"`
	Turn        string               `json:"turn"`
	Status      string               `json:"status"`
	MoveHistory []MoveJSON           `json:"moveHistory"`
	InCheck     bool                 `json:"inCheck"`
	CheckSquare string               `json:"checkSquare,omitempty"`
	UndoRequest *UndoRequestJSON     `json:"undoRequest,omitempty"`
}

// UndoRequestJSON is the JSON representation of an undo request.
type UndoRequestJSON struct {
	RequestedBy string `json:"requestedBy"`
}

// MovesResponseJSON is the response for legal moves.
type MovesResponseJSON struct {
	Moves []MoveJSON `json:"moves"`
}

// MoveRequestJSON is the request to make a move.
type MoveRequestJSON struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Promotion string `json:"promotion,omitempty"`
}

// UndoRequestBodyJSON is the request body for requesting undo.
type UndoRequestBodyJSON struct {
	Color string `json:"color"`
}

// ErrorJSON is the error response.
type ErrorJSON struct {
	Error string `json:"error"`
}

// ToGameJSON converts a domain Game to JSON representation.
func ToGameJSON(game domain.Game) GameJSON {
	boardMap := make(map[string]PieceJSON)
	for pos, piece := range game.Board.ToMap() {
		boardMap[pos] = PieceJSON{
			Type:  piece.Type.String(),
			Color: piece.Color.String(),
		}
	}

	history := make([]MoveJSON, len(game.MoveHistory))
	for i, move := range game.MoveHistory {
		moveJSON := MoveJSON{
			From: move.From.String(),
			To:   move.To.String(),
		}
		if move.Promotion != 0 {
			moveJSON.Promotion = move.Promotion.String()
		}
		history[i] = moveJSON
	}

	result := GameJSON{
		ID:          game.ID,
		Board:       boardMap,
		Turn:        game.Turn.String(),
		Status:      game.Status.String(),
		MoveHistory: history,
		InCheck:     game.Status == domain.Check || game.Status == domain.Checkmate,
	}

	// Find the king in check to highlight
	if result.InCheck {
		kingPos, found := game.Board.FindKing(game.Turn)
		if found {
			result.CheckSquare = kingPos.String()
		}
	}

	// Add undo request if present
	if game.UndoRequest != nil {
		result.UndoRequest = &UndoRequestJSON{
			RequestedBy: game.UndoRequest.RequestedBy.String(),
		}
	}

	return result
}

// ToMovesResponseJSON converts domain moves to JSON representation.
func ToMovesResponseJSON(moves []domain.Move) MovesResponseJSON {
	result := make([]MoveJSON, len(moves))
	for i, move := range moves {
		moveJSON := MoveJSON{
			From: move.From.String(),
			To:   move.To.String(),
		}
		if move.Promotion != 0 {
			moveJSON.Promotion = move.Promotion.String()
		}
		result[i] = moveJSON
	}
	return MovesResponseJSON{Moves: result}
}

// ParsePromotion converts a promotion string to domain PieceType.
func ParsePromotion(s string) domain.PieceType {
	switch s {
	case "queen":
		return domain.Queen
	case "rook":
		return domain.Rook
	case "bishop":
		return domain.Bishop
	case "knight":
		return domain.Knight
	default:
		return 0
	}
}

// ParseColor converts a color string to domain Color.
func ParseColor(s string) (domain.Color, bool) {
	switch s {
	case "white":
		return domain.White, true
	case "black":
		return domain.Black, true
	default:
		return domain.White, false
	}
}
