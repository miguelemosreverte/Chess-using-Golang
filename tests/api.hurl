# Chess API Tests
# Run with: hurl --test tests/api.hurl

# ===========================================
# Test 1: Create a new game
# ===========================================
POST http://localhost:8080/api/games
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
jsonpath "$.moveHistory" count == 0


# ===========================================
# Test 2: Get game state
# ===========================================
GET http://localhost:8080/api/games/{{game_id}}
HTTP 200
[Asserts]
jsonpath "$.id" == {{game_id}}
jsonpath "$.turn" == "white"
jsonpath "$.status" == "ongoing"


# ===========================================
# Test 3: Get legal moves for e2 pawn
# ===========================================
GET http://localhost:8080/api/games/{{game_id}}/moves?from=e2
HTTP 200
[Asserts]
jsonpath "$.moves" count == 2


# ===========================================
# Test 4: Make opening move e2-e4
# ===========================================
POST http://localhost:8080/api/games/{{game_id}}/moves
Content-Type: application/json
{"from": "e2", "to": "e4"}
HTTP 200
[Asserts]
jsonpath "$.turn" == "black"
jsonpath "$.board.e4.type" == "pawn"
jsonpath "$.moveHistory" count == 1


# ===========================================
# Test 5: Chat - empty initially
# ===========================================
GET http://localhost:8080/api/games/{{game_id}}/chat
HTTP 200
[Asserts]
jsonpath "$" count == 0


# ===========================================
# Test 6: Chat - Player 1 sends message
# ===========================================
POST http://localhost:8080/api/games/{{game_id}}/chat
Content-Type: application/json
{"player": "player1", "message": "Hello!", "time": 1000}
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"


# ===========================================
# Test 7: Chat - Verify message was stored
# ===========================================
GET http://localhost:8080/api/games/{{game_id}}/chat
HTTP 200
[Asserts]
jsonpath "$" count == 1
jsonpath "$[0].player" == "player1"
jsonpath "$[0].message" == "Hello!"


# ===========================================
# Test 8: Chat - Player 2 sends message
# ===========================================
POST http://localhost:8080/api/games/{{game_id}}/chat
Content-Type: application/json
{"player": "player2", "message": "Hi there!", "time": 2000}
HTTP 200


# ===========================================
# Test 9: Chat - Both messages present
# ===========================================
GET http://localhost:8080/api/games/{{game_id}}/chat
HTTP 200
[Asserts]
jsonpath "$" count == 2
jsonpath "$[0].player" == "player1"
jsonpath "$[0].message" == "Hello!"
jsonpath "$[1].player" == "player2"
jsonpath "$[1].message" == "Hi there!"


# ===========================================
# Test 10: Game not found
# ===========================================
GET http://localhost:8080/api/games/nonexistent
HTTP 404
[Asserts]
jsonpath "$.error" == "game not found"


# ===========================================
# Test 11: Chat for non-existent game returns empty
# ===========================================
GET http://localhost:8080/api/games/nonexistent/chat
HTTP 200
[Asserts]
jsonpath "$" count == 0
