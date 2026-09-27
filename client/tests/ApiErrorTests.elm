module ApiErrorTests exposing (all)

{-| The client must surface the server's contract error code and message, not
just a status number: a stale-version refusal is actionable, "server returned
status 409" is not.
-}

import Api
import Expect
import Test exposing (Test, describe, test)


all : Test
all =
    describe "API error envelope"
        [ test "decodes a contract error envelope into a readable message" <|
            \_ ->
                Api.errorToString
                    (Api.fromBadStatus
                        409
                        """{"error":{"code":"version_conflict","message":"session version is 3, command expected 2","requestId":"r1"}}"""
                    )
                    |> Expect.equal "version_conflict (409): session version is 3, command expected 2"
        , test "falls back to a synthetic code when the body is not an envelope" <|
            \_ ->
                Api.errorToString (Api.fromBadStatus 500 "<html>gateway blew up</html>")
                    |> Expect.equal "unknown_error (500): server returned status 500"
        , test "transport failures still read as transport failures" <|
            \_ ->
                Api.errorToString Api.NetworkError
                    |> Expect.equal "cannot reach the server (is it running?)"
        ]
