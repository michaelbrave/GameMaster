module Battle exposing (Model, Msg(..), init, update, view)

import Api
import BoardGrid
import Html exposing (Html, button, div, h1, h2, input, label, li, option, p, section, select, span, text, ul)
import Html.Attributes as A
import Html.Events exposing (onClick, onInput)
import Http
import Json.Decode as D
import Json.Encode as E
import Svg
import Svg.Attributes as S
import Types exposing (Axial, axial)


type alias Token =
    { id : String, label : String, kind : String, position : Axial, allowance : Int, spent : Int }


type alias Route =
    { to : Axial, cost : Int, path : List Axial }


type alias Routes =
    { tokenId : String, destinations : List Route }


type alias Board =
    { version : Int
    , location : Axial
    , gridType : String
    , radius : Int
    , feetPerStep : Int
    , terrain : String
    , color : String
    , tokens : List Token
    , obstacles : List Axial
    , routes : List Routes
    }


type alias Model =
    { url : String
    , board : Maybe Board
    , busy : Bool
    , error : Maybe String
    , selected : Maybe String
    , destination : Maybe Axial
    , mode : String
    , label : String
    , kind : String
    , allowance : String
    , radius : String
    , feet : String
    , counter : Int
    , enemy : Maybe String
    }


type Msg
    = Loaded (Result Api.Error Board)
    | Reload
    | Close
    | Select String
    | ClickSpace Axial
    | Mode String
    | Label String
    | Kind String
    | Allowance String
    | Radius String
    | Feet String
    | Move
    | Remove
    | Reset
    | Settings


required : String -> D.Decoder a -> D.Decoder (a -> b) -> D.Decoder b
required field fieldDecoder fn =
    D.map2 (|>) (D.field field fieldDecoder) fn


decoder : D.Decoder Board
decoder =
    D.succeed Board
        |> required "version" D.int
        |> required "location" axial
        |> required "gridType" D.string
        |> required "radius" D.int
        |> required "feetPerStep" D.int
        |> required "terrain" D.string
        |> required "color" D.string
        |> required "tokens"
            (D.list
                (D.map6 Token
                    (D.field "id" D.string)
                    (D.field "label" D.string)
                    (D.field "kind" D.string)
                    (D.field "position" axial)
                    (D.field "allowance" D.int)
                    (D.field "spent" D.int)
                )
            )
        |> required "obstacles" (D.list axial)
        |> required "routes"
            (D.list
                (D.map2 Routes
                    (D.field "tokenId" D.string)
                    (D.field "destinations"
                        (D.list
                            (D.map3 Route
                                (D.field "to" axial)
                                (D.field "cost" D.int)
                                (D.field "path" (D.list axial))
                            )
                        )
                    )
                )
            )


expectBoard : Http.Expect Msg
expectBoard =
    Http.expectStringResponse Loaded
        (\response ->
            case response of
                Http.BadUrl_ url ->
                    Err (Api.BadUrl url)

                Http.Timeout_ ->
                    Err Api.Timeout

                Http.NetworkError_ ->
                    Err Api.NetworkError

                Http.BadStatus_ metadata body ->
                    Err
                        (case
                            D.decodeString
                                (D.map2 Tuple.pair
                                    (D.field "code" D.string)
                                    (D.field "message" D.string)
                                    |> D.field "error"
                                )
                                body
                         of
                            Ok ( code, message ) ->
                                Api.ServerRejected metadata.statusCode code message

                            Err _ ->
                                Api.ServerRejected
                                    metadata.statusCode
                                    "unknown_error"
                                    "The action could not be saved. Reload the battlefield."
                        )

                Http.GoodStatus_ _ body ->
                    D.decodeString decoder body
                        |> Result.mapError (D.errorToString >> Api.BadResponseBody)
        )


init : String -> String -> Axial -> Maybe String -> ( Model, Cmd Msg )
init base sessionId at enemy =
    let
        model =
            { url = base ++ "/api/v1/sessions/" ++ sessionId ++ "/battlefields/" ++ String.fromInt at.q ++ "/" ++ String.fromInt at.r
            , board = Nothing
            , busy = True
            , error = Nothing
            , selected = Nothing
            , destination = Nothing
            , mode = "move"
            , label = "Goblin"
            , kind = "enemy"
            , allowance = "6"
            , radius = "4"
            , feet = "5"
            , counter = 0
            , enemy = enemy
            }
    in
    ( model, Http.get { url = model.url, expect = expectBoard } )


encodeAt : Axial -> E.Value
encodeAt at =
    E.object [ ( "q", E.int at.q ), ( "r", E.int at.r ) ]


send : String -> List ( String, E.Value ) -> Model -> ( Model, Cmd Msg )
send action fields model =
    case model.board of
        Just board ->
            if model.busy then
                ( model, Cmd.none )

            else
                ( { model | busy = True, error = Nothing, counter = model.counter + 1 }
                , Http.post
                    { url = model.url
                    , body =
                        Http.jsonBody
                            (E.object
                                [ ( "expectedVersion", E.int board.version )
                                , ( "commandId", E.string ("battle-" ++ String.fromInt board.version ++ "-" ++ String.fromInt (model.counter + 1) ++ "-" ++ action) )
                                , ( "action", E.object (( "type", E.string action ) :: fields) )
                                ]
                            )
                    , expect = expectBoard
                    }
                )

        Nothing ->
            ( model, Cmd.none )


selectedToken : Model -> Maybe Token
selectedToken model =
    model.board |> Maybe.andThen (\b -> List.filter (\t -> Just t.id == model.selected) b.tokens |> List.head)


routes : Model -> List Route
routes model =
    model.board
        |> Maybe.andThen (\b -> List.filter (\r -> Just r.tokenId == model.selected) b.routes |> List.head)
        |> Maybe.map .destinations
        |> Maybe.withDefault []


chosenRoute : Model -> Maybe Route
chosenRoute model =
    routes model |> List.filter (\r -> Just r.to == model.destination) |> List.head


{-| When the battlefield was opened from a combat encounter, drop one enemy
token for the antagonists on the farthest free space. Never duplicates a token
with the same label.
-}
placeEnemy : Model -> ( Model, Cmd Msg )
placeEnemy model =
    case ( model.enemy, model.board ) of
        ( Just label, Just board ) ->
            if List.any (\t -> t.label == label) board.tokens then
                ( { model | enemy = Nothing }, Cmd.none )

            else
                case placementFor board of
                    Just at ->
                        send "add"
                            [ ( "at", encodeAt at )
                            , ( "label", E.string label )
                            , ( "kind", E.string "enemy" )
                            , ( "allowance", E.int 6 )
                            ]
                            { model | enemy = Nothing }

                    Nothing ->
                        ( { model | enemy = Nothing }, Cmd.none )

        _ ->
            ( model, Cmd.none )


{-| The free space farthest from the board center — enemies start opposite
the party's side.
-}
placementFor : Board -> Maybe Axial
placementFor board =
    spaces board
        |> List.filter
            (\at ->
                not (List.member at board.obstacles)
                    && not (List.any (\t -> t.position == at) board.tokens)
            )
        |> List.sortBy (\at -> -(at.q * at.q + at.r * at.r))
        |> List.head


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Loaded (Ok board) ->
            placeEnemy
                { model
                    | board = Just board
                    , busy = False
                    , error = Nothing
                    , destination = Nothing
                    , selected =
                        if List.any (\t -> Just t.id == model.selected) board.tokens then
                            model.selected

                        else
                            List.head board.tokens |> Maybe.map .id
                    , radius = String.fromInt board.radius
                    , feet = String.fromInt board.feetPerStep
                }

        Loaded (Err error) ->
            ( { model
                | busy = False
                , error =
                    Just
                        (case error of
                            Api.ServerRejected _ code message ->
                                code ++ ": " ++ message

                            Api.BadResponseBody message ->
                                message

                            _ ->
                                "Could not reach the server. Reload to check whether your last action was saved."
                        )
              }
            , Cmd.none
            )

        Reload ->
            ( { model | busy = True, destination = Nothing }, Http.get { url = model.url, expect = expectBoard } )

        Close ->
            ( model, Cmd.none )

        Select id ->
            ( { model | selected = Just id, destination = Nothing, mode = "move" }, Cmd.none )

        Mode mode ->
            ( { model | mode = mode, destination = Nothing, error = Nothing }, Cmd.none )

        Label value ->
            ( { model | label = value }, Cmd.none )

        Kind value ->
            ( { model | kind = value }, Cmd.none )

        Allowance value ->
            ( { model | allowance = value }, Cmd.none )

        Radius value ->
            ( { model | radius = value }, Cmd.none )

        Feet value ->
            ( { model | feet = value }, Cmd.none )

        ClickSpace at ->
            if model.busy then
                ( model, Cmd.none )

            else if model.mode == "obstacle" then
                send "obstacle" [ ( "at", encodeAt at ) ] model

            else if model.mode == "place" then
                send "add"
                    [ ( "at", encodeAt at )
                    , ( "label", E.string model.label )
                    , ( "kind", E.string model.kind )
                    , ( "allowance", E.int (String.toInt model.allowance |> Maybe.withDefault 0) )
                    ]
                    model

            else
                case model.board |> Maybe.andThen (\b -> List.filter (\t -> t.position == at) b.tokens |> List.head) of
                    Just token ->
                        update (Select token.id) model

                    Nothing ->
                        if List.any (\r -> r.to == at) (routes model) then
                            ( { model | destination = Just at, error = Nothing }, Cmd.none )

                        else
                            ( { model | destination = Nothing, error = Just "That space is blocked or beyond this token’s remaining movement." }, Cmd.none )

        Move ->
            case ( model.selected, chosenRoute model ) of
                ( Just id, Just route ) ->
                    send "move" [ ( "tokenId", E.string id ), ( "to", encodeAt route.to ) ] model

                _ ->
                    ( model, Cmd.none )

        Remove ->
            case model.selected of
                Just id ->
                    send "remove" [ ( "tokenId", E.string id ) ] model

                Nothing ->
                    ( model, Cmd.none )

        Reset ->
            send "reset" [] model

        Settings ->
            send "settings"
                [ ( "radius", E.int (String.toInt model.radius |> Maybe.withDefault 0) )
                , ( "feetPerStep", E.int (String.toInt model.feet |> Maybe.withDefault 0) )
                ]
                model


coord : Axial -> String
coord at =
    String.fromInt at.q ++ "," ++ String.fromInt at.r


spaces : Board -> List Axial
spaces board =
    let
        limit =
            if board.gridType == "hex" then
                board.radius

            else
                2 * board.radius
    in
    List.range -limit limit
        |> List.concatMap
            (\r ->
                List.range -limit limit
                    |> List.filter
                        (\q ->
                            if board.gridType == "hex" then
                                abs (q + r) <= limit

                            else
                                modBy 2 q == modBy 2 r
                        )
                    |> List.map (\q -> { q = q, r = r })
            )


tokenColor : String -> String
tokenColor kind =
    case kind of
        "character" ->
            "#7cc7ff"

        "enemy" ->
            "#ff8a8a"

        _ ->
            "#ffd97c"


boardView : Model -> Board -> Html Msg
boardView model board =
    let
        reachable =
            routes model

        path =
            chosenRoute model |> Maybe.map .path |> Maybe.withDefault []

        tile at =
            let
                blocked =
                    List.member at board.obstacles

                cost =
                    List.filter (\r -> r.to == at) reachable |> List.head |> Maybe.map .cost

                ( x, y ) =
                    BoardGrid.pixelFor board.gridType at

                title =
                    "Space "
                        ++ coord at
                        ++ (if blocked then
                                " · obstacle"

                            else
                                cost |> Maybe.map (\n -> " · " ++ String.fromInt n ++ " steps") |> Maybe.withDefault ""
                           )
            in
            Svg.g
                [ onClick (ClickSpace at)
                , A.attribute "role" "button"
                , A.attribute "tabindex" "0"
                , A.attribute "aria-label" title
                , Html.Events.preventDefaultOn "keydown"
                    (D.field "key" D.string
                        |> D.andThen
                            (\key ->
                                if key == "Enter" || key == " " then
                                    D.succeed ( ClickSpace at, True )

                                else
                                    D.fail "not activation"
                            )
                    )
                , S.class "battle-space"
                ]
                [ Svg.title [] [ Svg.text title ]
                , Svg.polygon
                    [ S.points (BoardGrid.points board.gridType at)
                    , S.fill
                        (if blocked then
                            "#353642"

                         else if List.member at path then
                            "#78672c"

                         else if cost /= Nothing && model.mode == "move" then
                            "#2e5550"

                         else
                            board.color
                        )
                    , S.fillOpacity
                        (if blocked || cost /= Nothing || List.member at path then
                            "0.9"

                         else
                            "0.32"
                        )
                    , S.stroke
                        (if Just at == model.destination then
                            "#ffd97c"

                         else
                            "#737584"
                        )
                    , S.strokeWidth
                        (if Just at == model.destination then
                            "3"

                         else
                            "1"
                        )
                    ]
                    []
                , Svg.text_ [ S.x (String.fromFloat x), S.y (String.fromFloat (y + 4)), S.textAnchor "middle", S.fontSize "11", S.fill "#e8e8f0", S.pointerEvents "none" ]
                    [ Svg.text
                        (if blocked then
                            "×"

                         else if model.mode == "move" then
                            cost |> Maybe.map String.fromInt |> Maybe.withDefault ""

                         else
                            ""
                        )
                    ]
                ]

        tokenView token =
            let
                ( x, y ) =
                    BoardGrid.pixelFor board.gridType token.position

                small =
                    BoardGrid.isDiamond board.gridType token.position
            in
            Svg.g [ S.pointerEvents "none" ]
                [ Svg.circle
                    [ S.cx (String.fromFloat x)
                    , S.cy (String.fromFloat y)
                    , S.r
                        (if small then
                            "9"

                         else
                            "20"
                        )
                    , S.fill (tokenColor token.kind)
                    , S.stroke
                        (if Just token.id == model.selected then
                            "#fff"

                         else
                            "#14141f"
                        )
                    , S.strokeWidth "3"
                    ]
                    []
                , Svg.text_
                    [ S.x (String.fromFloat x)
                    , S.y (String.fromFloat (y + 4))
                    , S.fontSize
                        (if small then
                            "9"

                         else
                            "12"
                        )
                    , S.textAnchor "middle"
                    , S.fill "#14141f"
                    , S.fontWeight "bold"
                    ]
                    [ Svg.text
                        (String.left
                            (if small then
                                1

                             else
                                2
                            )
                            token.label
                            |> String.toUpper
                        )
                    ]
                ]
    in
    Svg.svg [ S.viewBox (BoardGrid.viewBoxFor board.gridType board.radius), S.class "battle-map", A.attribute "aria-label" "Tactical battlefield" ]
        (List.map tile (spaces board) ++ List.map tokenView board.tokens)


view : Model -> Html Msg
view model =
    div [ A.class "layout" ]
        [ Html.header [ A.class "topbar" ]
            [ h1 [] [ text "Battlefield sandbox" ]
            , span [ A.class "hint" ] [ text "Run the scene or arrange it" ]
            , div [ A.class "topbar-actions" ]
                [ button [ onClick Reload, A.disabled model.busy ] [ text "Reload battlefield" ]
                , button [ onClick Close, A.disabled model.busy ] [ text "Return to world" ]
                ]
            ]
        , case model.error of
            Just message ->
                div [ A.class "error-banner", A.attribute "role" "alert" ] [ text message ]

            Nothing ->
                text ""
        , case model.board of
            Nothing ->
                p [ A.class "hint" ]
                    [ text
                        (if model.busy then
                            "Opening battlefield…"

                         else
                            "Battlefield unavailable. Try reloading."
                        )
                    ]

            Just board ->
                div [ A.class "battle-layout" ]
                    [ section [ A.class "map-panel" ]
                        [ h2 [] [ text (board.terrain ++ " · world space " ++ coord board.location) ]
                        , p [ A.class "hint" ] [ text (String.fromInt (2 * board.radius + 1) ++ " tiles across · " ++ String.fromInt board.feetPerStep ++ " ft per step · " ++ String.fromInt ((2 * board.radius + 1) * board.feetPerStep) ++ " ft nominal area width") ]
                        , boardView model board
                        , p [ A.class "hint" ] [ text "A cardinal step or a step onto a diamond costs one move. Reaching the square beyond a diamond costs two. Circles and × obstacles block movement." ]
                        ]
                    , Html.aside [ A.class "side-panel" ]
                        [ section []
                            [ h2 [] [ text "Board tools" ]
                            , div [ A.class "choices", A.attribute "role" "group", A.attribute "aria-label" "Board mode" ]
                                [ button
                                    [ onClick (Mode "move")
                                    , A.disabled model.busy
                                    , A.class
                                        (if model.mode == "move" then
                                            "active"

                                         else
                                            ""
                                        )
                                    ]
                                    [ text "Run" ]
                                , button
                                    [ onClick (Mode "place")
                                    , A.disabled model.busy
                                    , A.class
                                        (if model.mode == "move" then
                                            ""

                                         else
                                            "active"
                                        )
                                    ]
                                    [ text "Arrange" ]
                                ]
                            , if model.mode == "move" then
                                p [ A.class "hint" ] [ text "Select a token, then a numbered destination to preview its route. Confirm with Move." ]

                              else
                                div []
                                    [ div [ A.class "choices" ]
                                        [ button
                                            [ onClick (Mode "place")
                                            , A.disabled model.busy
                                            , A.class
                                                (if model.mode == "place" then
                                                    "active"

                                                 else
                                                    ""
                                                )
                                            ]
                                            [ text "Place token" ]
                                        , button
                                            [ onClick (Mode "obstacle")
                                            , A.disabled model.busy
                                            , A.class
                                                (if model.mode == "obstacle" then
                                                    "active"

                                                 else
                                                    ""
                                                )
                                            ]
                                            [ text "Obstacles" ]
                                        ]
                                    , if model.mode == "place" then
                                        div []
                                            [ label [] [ text "Token name", input [ A.value model.label, onInput Label, A.maxlength 40 ] [] ]
                                            , label [] [ text "Kind", select [ onInput Kind, A.value model.kind, A.attribute "aria-label" "Token kind" ] (List.map (\kind -> option [ A.value kind, A.selected (kind == model.kind) ] [ text kind ]) [ "character", "enemy", "object" ]) ]
                                            , numberField "Movement allowance (steps)" model.allowance Allowance 1 30
                                            , p [ A.class "hint" ] [ text "Click an empty space to place this token. Objects block movement and cannot move." ]
                                            ]

                                      else
                                        p [ A.class "hint" ] [ text "Click a space to add or remove an obstacle. Occupied spaces cannot become obstacles." ]
                                    ]
                            ]
                        , section []
                            [ h2 [] [ text "Tokens" ]
                            , ul [ A.class "battle-roster" ]
                                (List.map
                                    (\token ->
                                        li []
                                            [ button
                                                [ onClick (Select token.id)
                                                , A.disabled model.busy
                                                , A.class
                                                    (if Just token.id == model.selected then
                                                        "active"

                                                     else
                                                        ""
                                                    )
                                                ]
                                                [ span [ A.style "color" (tokenColor token.kind) ] [ text "● " ]
                                                , text (token.label ++ " · " ++ token.kind ++ " · " ++ coord token.position)
                                                ]
                                            ]
                                    )
                                    board.tokens
                                )
                            , case selectedToken model of
                                Nothing ->
                                    p [] [ text "Place a token to begin." ]

                                Just token ->
                                    div []
                                        [ p [ A.class "hint" ]
                                            [ text
                                                (if token.kind == "object" then
                                                    "Stationary object"

                                                 else
                                                    String.fromInt (token.allowance - token.spent) ++ " / " ++ String.fromInt token.allowance ++ " steps remaining"
                                                )
                                            ]
                                        , case chosenRoute model of
                                            Nothing ->
                                                text ""

                                            Just route ->
                                                p [ A.class "battle-route", A.attribute "aria-live" "polite" ]
                                                    [ text ("Route: " ++ String.join " → " (List.map coord route.path) ++ " · " ++ String.fromInt route.cost ++ " steps / " ++ String.fromInt (route.cost * board.feetPerStep) ++ " ft") ]
                                        , div [ A.class "choices" ]
                                            [ button [ onClick Move, A.disabled (model.busy || chosenRoute model == Nothing), A.class "primary" ] [ text "Move to destination" ]
                                            , button [ onClick Remove, A.disabled model.busy ] [ text "Remove selected" ]
                                            ]
                                        ]
                            , button [ onClick Reset, A.disabled model.busy ] [ text "Reset all movement" ]
                            ]
                        , if model.mode == "move" then
                            text ""

                          else
                            section []
                                [ h2 [] [ text "Area scale" ]
                                , numberField "Radius in large tiles" model.radius Radius 2 8
                                , numberField "Feet per movement step" model.feet Feet 1 100
                                , button [ onClick Settings, A.disabled model.busy ] [ text "Apply scale" ]
                                , p [ A.class "hint" ] [ text "This battlefield represents the current world space. Scaling preserves positions; shrinking cannot remove occupied spaces." ]
                                ]
                        , section []
                            [ p [ A.class "hint", A.attribute "role" "status" ]
                                [ text
                                    (if model.busy then
                                        "Saving / loading…"

                                     else
                                        "Saved with this session and world location. Returning to exploration preserves the board."
                                    )
                                ]
                            , p [ A.class "hint" ] [ text "Movement sandbox: no attacks or initiative yet — party-turn combat is planned. Board edits never advance world time." ]
                            ]
                        ]
                    ]
        ]


numberField : String -> String -> (String -> Msg) -> Int -> Int -> Html Msg
numberField caption value toMsg minimum maximum =
    label [] [ text caption, input [ A.type_ "number", A.value value, onInput toMsg, A.min (String.fromInt minimum), A.max (String.fromInt maximum), A.step "1" ] [] ]
