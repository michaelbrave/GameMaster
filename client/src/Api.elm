module Api exposing
    ( BaseUrl
    , Error(..)
    , HttpError
    , createSession
    , createWorld
    , encodeAxial
    , encounterAction
    , errorToString
    , fromBadStatus
    , getCreatorHistory
    , getHexDetail
    , getHistory
    , getMap
    , getSessionState
    , getTable
    , getTables
    , previewRolls
    , publishTable
    , travel
    , validateDraft
    )

import Http
import Json.Decode as Decode
import Json.Encode as Encode
import Types exposing (..)


{-| Typed API boundary. All calls go through here; transport errors are
rendered for the banner, and contract error envelopes surface via messages.
-}
type alias BaseUrl =
    String


{-| Transport-level failures, plus the server's contract error envelope so the
player is told _why_ a request was refused rather than just the status number.
-}
type Error
    = BadUrl String
    | Timeout
    | NetworkError
    | ServerRejected Int String String
    | BadResponseBody String


type alias HttpError =
    Error


{-| The shared error envelope: { error: { code, message } }.
-}
errorEnvelope : Decode.Decoder ( String, String )
errorEnvelope =
    Decode.map2 Tuple.pair
        (Decode.field "code" Decode.string)
        (Decode.field "message" Decode.string)
        |> Decode.field "error"


fromBadStatus : Int -> String -> Error
fromBadStatus status body =
    case Decode.decodeString errorEnvelope body of
        Ok ( code, message ) ->
            ServerRejected status code message

        Err _ ->
            ServerRejected
                status
                "unknown_error"
                ("server returned status " ++ String.fromInt status)


{-| Decode a success payload, or the contract error envelope on a failure
status. `Http.expectJson` discards the response body on error, which is where
the only useful explanation lives.
-}
expect : Decode.Decoder a -> (Result Error a -> msg) -> Http.Expect msg
expect decoder toMsg =
    Http.expectStringResponse toMsg
        (\response ->
            case response of
                Http.GoodStatus_ _ body ->
                    case Decode.decodeString decoder body of
                        Ok value ->
                            Ok value

                        Err decodeError ->
                            Err (BadResponseBody (Decode.errorToString decodeError))

                Http.BadStatus_ metadata body ->
                    Err (fromBadStatus metadata.statusCode body)

                Http.NetworkError_ ->
                    Err NetworkError

                Http.Timeout_ ->
                    Err Timeout

                Http.BadUrl_ url ->
                    Err (BadUrl url)
        )


errorToString : Error -> String
errorToString err =
    case err of
        BadUrl url ->
            "bad url: " ++ url

        Timeout ->
            "request timed out"

        NetworkError ->
            "cannot reach the server (is it running?)"

        ServerRejected status code message ->
            code ++ " (" ++ String.fromInt status ++ "): " ++ message

        BadResponseBody message ->
            "could not decode server response: " ++ message


createWorld : BaseUrl -> String -> String -> String -> (Result Error World -> msg) -> Cmd msg
createWorld base name seed grid toMsg =
    Http.post
        { url = base ++ "/api/v1/worlds"
        , body =
            Http.jsonBody
                (Encode.object
                    [ ( "name", Encode.string name )
                    , ( "seed", Encode.string seed )
                    , ( "gridType", Encode.string grid )
                    ]
                )
        , expect = expect world toMsg
        }


createSession : BaseUrl -> String -> String -> Bool -> Bool -> (Result Error SessionState -> msg) -> Cmd msg
createSession base worldId characterName tablePreview completeHistory toMsg =
    Http.post
        { url = base ++ "/api/v1/sessions"
        , body =
            Http.jsonBody
                (Encode.object
                    [ ( "worldId", Encode.string worldId )
                    , ( "characterName", Encode.string characterName )
                    , ( "creatorPolicy"
                      , Encode.object
                            [ ( "tablePreview", Encode.bool tablePreview )
                            , ( "completeHistory", Encode.bool completeHistory )
                            ]
                      )
                    ]
                )
        , expect = expect sessionState toMsg
        }


getSessionState : BaseUrl -> String -> (Result Error SessionState -> msg) -> Cmd msg
getSessionState base sessionId toMsg =
    Http.get
        { url = base ++ "/api/v1/sessions/" ++ sessionId
        , expect = expect sessionState toMsg
        }


getMap : BaseUrl -> String -> (Result Error MapData -> msg) -> Cmd msg
getMap base sessionId toMsg =
    Http.get
        { url = base ++ "/api/v1/sessions/" ++ sessionId ++ "/map"
        , expect = expect mapData toMsg
        }


getHexDetail : BaseUrl -> String -> Axial -> (Result Error HexDetail -> msg) -> Cmd msg
getHexDetail base sessionId at toMsg =
    Http.get
        { url =
            base
                ++ "/api/v1/sessions/"
                ++ sessionId
                ++ "/hexes/"
                ++ String.fromInt at.q
                ++ "/"
                ++ String.fromInt at.r
        , expect = expect hexDetail toMsg
        }


getHistory : BaseUrl -> String -> (Result Error HistoryResponse -> msg) -> Cmd msg
getHistory base sessionId toMsg =
    Http.get
        { url = base ++ "/api/v1/sessions/" ++ sessionId ++ "/history?limit=200"
        , expect = expect historyResponse toMsg
        }


travel : BaseUrl -> String -> String -> Int -> Axial -> (Result Error CommandResponse -> msg) -> Cmd msg
travel base sessionId idempotencyKey expectedVersion to toMsg =
    Http.post
        { url = base ++ "/api/v1/sessions/" ++ sessionId ++ "/commands/travel"
        , body =
            Http.jsonBody
                (Encode.object
                    [ ( "idempotencyKey", Encode.string idempotencyKey )
                    , ( "expectedVersion", Encode.int expectedVersion )
                    , ( "to", encodeAxial to )
                    ]
                )
        , expect = expect commandResponse toMsg
        }


encounterAction : BaseUrl -> String -> String -> Int -> String -> (Result Error CommandResponse -> msg) -> Cmd msg
encounterAction base sessionId idempotencyKey expectedVersion choiceId toMsg =
    Http.post
        { url = base ++ "/api/v1/sessions/" ++ sessionId ++ "/commands/encounter-action"
        , body =
            Http.jsonBody
                (Encode.object
                    [ ( "idempotencyKey", Encode.string idempotencyKey )
                    , ( "expectedVersion", Encode.int expectedVersion )
                    , ( "choiceId", Encode.string choiceId )
                    ]
                )
        , expect = expect commandResponse toMsg
        }


encodeAxial : Axial -> Encode.Value
encodeAxial at =
    Encode.object [ ( "q", Encode.int at.q ), ( "r", Encode.int at.r ) ]


getTables : BaseUrl -> (Result Error (List TableListItem) -> msg) -> Cmd msg
getTables base toMsg =
    Http.get
        { url = base ++ "/api/v1/tables"
        , expect = expect tableList toMsg
        }


getTable : BaseUrl -> String -> (Result Error TableVersions -> msg) -> Cmd msg
getTable base tableId toMsg =
    Http.get
        { url = base ++ "/api/v1/tables/" ++ tableId
        , expect = expect tableVersions toMsg
        }


validateDraft : BaseUrl -> Encode.Value -> (Result Error ValidateResult -> msg) -> Cmd msg
validateDraft base draft toMsg =
    Http.post
        { url = base ++ "/api/v1/tables/validate"
        , body = Http.jsonBody (Encode.object [ ( "draft", draft ) ])
        , expect = expect validateResult toMsg
        }


previewRolls : BaseUrl -> String -> ( String, Encode.Value ) -> String -> Int -> (Result Error PreviewResult -> msg) -> Cmd msg
previewRolls base sessionId tableRefOrDraft seed count toMsg =
    Http.post
        { url = base ++ "/api/v1/tables/preview"
        , body =
            Http.jsonBody
                (Encode.object
                    [ ( "sessionId", Encode.string sessionId )
                    , ( "seed", Encode.string seed )
                    , ( "count", Encode.int count )
                    , tableRefOrDraft
                    ]
                )
        , expect = expect previewResult toMsg
        }


publishTable : BaseUrl -> String -> Encode.Value -> (Result Error Encode.Value -> msg) -> Cmd msg
publishTable base sessionId definition toMsg =
    Http.post
        { url = base ++ "/api/v1/tables"
        , body =
            Http.jsonBody
                (Encode.object
                    [ ( "sessionId", Encode.string sessionId )
                    , ( "definition", definition )
                    ]
                )
        , expect = expect Decode.value toMsg
        }


getCreatorHistory : BaseUrl -> String -> (Result Error CreatorHistory -> msg) -> Cmd msg
getCreatorHistory base sessionId toMsg =
    Http.get
        { url = base ++ "/api/v1/sessions/" ++ sessionId ++ "/creator/history"
        , expect = expect creatorHistory toMsg
        }
