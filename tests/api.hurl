# Chess API Tests
# Run with: hurl --test tests/api.hurl

# ===========================================
# Test 1: Create a new game
# ===========================================
POST http://localhost:8080/games
HTTP 201
[Captures]
game_id: jsonpath "$.id"
[Asserts]
jsonpath "$.id" exists
jsonpath "$.turn" == "white"
jsonpath "$.status" == "ongoing"
jsonpath "$.board.e1.type" == "king"
jsonpath "$.board.e1.color" == "white"
jsonpath "$.board.e8.type" == "king"
jsonpath "$.board.e8.color" == "black"
jsonpath "$.board.e2.type" == "pawn"
jsonpath "$.board.d1.type" == "queen"
jsonpath "$.moveHistory" count == 0


# ===========================================
# Test 2: Get game state
# ===========================================
GET http://localhost:8080/games/{{game_id}}
HTTP 200
[Asserts]
jsonpath "$.id" == {{game_id}}
jsonpath "$.turn" == "white"
jsonpath "$.status" == "ongoing"


# ===========================================
# Test 3: Get legal moves for e2 pawn
# ===========================================
GET http://localhost:8080/games/{{game_id}}/moves?from=e2
HTTP 200
[Asserts]
jsonpath "$.moves" count == 2


# ===========================================
# Test 4: Get all legal moves (white has 20 opening moves)
# ===========================================
GET http://localhost:8080/games/{{game_id}}/moves
HTTP 200
[Asserts]
jsonpath "$.moves" count == 20


# ===========================================
# Test 5: Make opening move e2-e4
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "e2", "to": "e4"}
HTTP 200
[Asserts]
jsonpath "$.turn" == "black"
jsonpath "$.status" == "ongoing"
jsonpath "$.board.e4.type" == "pawn"
jsonpath "$.board.e4.color" == "white"
jsonpath "$.board.e2" not exists
jsonpath "$.moveHistory" count == 1
jsonpath "$.moveHistory[0].from" == "e2"
jsonpath "$.moveHistory[0].to" == "e4"


# ===========================================
# Test 6: Black responds e7-e5
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "e7", "to": "e5"}
HTTP 200
[Asserts]
jsonpath "$.turn" == "white"
jsonpath "$.board.e5.type" == "pawn"
jsonpath "$.board.e5.color" == "black"
jsonpath "$.moveHistory" count == 2


# ===========================================
# Test 7: Invalid move - wrong turn
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "e5", "to": "e4"}
HTTP 400
[Asserts]
jsonpath "$.error" exists


# ===========================================
# Test 8: Invalid move - illegal pawn move
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "e4", "to": "e6"}
HTTP 400
[Asserts]
jsonpath "$.error" == "illegal move"


# ===========================================
# Test 9: Invalid move - no piece at source
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "e3", "to": "e4"}
HTTP 400
[Asserts]
jsonpath "$.error" == "no piece at source position"


# ===========================================
# Test 10: Game not found
# ===========================================
GET http://localhost:8080/games/nonexistent
HTTP 404
[Asserts]
jsonpath "$.error" == "game not found"


# ===========================================
# Test 11: Knight move
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "g1", "to": "f3"}
HTTP 200
[Asserts]
jsonpath "$.board.f3.type" == "knight"
jsonpath "$.board.f3.color" == "white"
jsonpath "$.turn" == "black"


# ===========================================
# Test 12: Black develops knight
# ===========================================
POST http://localhost:8080/games/{{game_id}}/moves
Content-Type: application/json
{"from": "b8", "to": "c6"}
HTTP 200
[Asserts]
jsonpath "$.board.c6.type" == "knight"
jsonpath "$.turn" == "white"


# ===========================================
# Test 13: Get legal moves for white knight (now it's white's turn)
# ===========================================
GET http://localhost:8080/games/{{game_id}}/moves?from=f3
HTTP 200
[Asserts]
jsonpath "$.moves" count >= 3


# ===========================================
# Test 14: Invalid position format
# ===========================================
GET http://localhost:8080/games/{{game_id}}/moves?from=invalid
HTTP 400
[Asserts]
jsonpath "$.error" contains "invalid position"
