port module Main exposing (main)

import Api
import Battle
import Browser
import Browser.Dom
import Browser.Events
import Build
import Fixtures
import Html exposing (Html)
import Json.Decode as Decode
import Process
import Setup
import State exposing (..)
import Task
import Types exposing (..)
import Views.Play as Play


{-| Remember the active session across page reloads (see index.html).
-}
port saveSession : String -> Cmd msg


port forgetSession : () -> Cmd msg


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = subscriptions
        }


init : Flags -> ( Model, Cmd Msg )
init flags =
    let
        model =
            { battlefield = Nothing
            , apiBase = flags.apiBase
            , fixtureMode = flags.fixtureMode
            , savedSessionId = flags.savedSessionId
            , screen = Setup
            , mode = PlayMode
            , setup = Setup.init
            , build = Nothing
            , session = Nothing
            , mapData = Nothing
            , log = []
            , viewMode = MapMode
            , panelTab = TabJournal
            , focusIndex = 0
            , selected = Nothing
            , lastResolution = Nothing
            , busy = False
            , error = Nothing
            , commandCounter = 0
            , hoveredHex = Nothing
            , hoverToken = 0
            , tooltipHex = Nothing
            , spotlightDismissed = False
            , positionFlash = False
            }
    in
    if flags.fixtureMode then
        loadFixtures model

    else
        case flags.savedSessionId of
            Just sessionId ->
                ( model, Api.getSessionState model.apiBase sessionId GotSavedSession )

            Nothing ->
                ( model, Cmd.none )


{-| Offline fixture-backed mode: the UI renders the recorded demo session
without a server. Commands are disabled with an explanatory notice.
-}
loadFixtures : Model -> ( Model, Cmd Msg )
loadFixtures model =
    let
        fixtureSession =
            Decode.decodeString sessionState Fixtures.sessionStateJson |> Result.toMaybe

        fixtureMap =
            Decode.decodeString mapData Fixtures.mapJson |> Result.toMaybe

        fixtureHistory =
            Decode.decodeString historyResponse Fixtures.historyJson |> Result.toMaybe

        fixtureTables =
            Decode.decodeString tableList Fixtures.tablesJson |> Result.toMaybe

        withBuild =
            case fixtureSession of
                Just state ->
                    let
                        ( build, _ ) =
                            Build.init
                                { apiBase = model.apiBase
                                , sessionId = state.session.id
                                , policy = state.session.creatorPolicy
                                , readOnly = True
                                }
                    in
                    { model | build = Just { build | tables = fixtureTables |> Maybe.withDefault [] } }

                Nothing ->
                    model
    in
    ( { withBuild
        | screen = Play
        , session = fixtureSession
        , mapData = fixtureMap
        , log = fixtureHistory |> Maybe.map .entries |> Maybe.withDefault []
        , error = Just "Fixture mode: showing a recorded demo session. Start the server and reload without ?fixtures=1 to play."
      }
    , Cmd.none
    )


{-| Enter (or resume) play with a freshly loaded session state.
-}
enterPlay : SessionState -> Model -> ( Model, Cmd Msg )
enterPlay state model =
    let
        setup =
            model.setup
    in
    ( { model
        | screen = Play
        , mode = PlayMode
        , busy = False
        , session = Just state
        , build = Nothing
        , spotlightDismissed = False
        , savedSessionId = Just state.session.id
        , setup = { setup | busy = False, error = Nothing, resume = Just state }
      }
    , Cmd.batch
        [ saveSession state.session.id
        , Api.getMap model.apiBase state.session.id GotMap
        , Api.getHistory model.apiBase state.session.id GotHistory
        ]
    )


{-| Scroll the journal to the newest entry (a no-op when it is not rendered).
-}
scrollJournal : Cmd Msg
scrollJournal =
    Task.attempt (\_ -> NoOp) (Browser.Dom.setViewportOf "journal-log" 0 1.0e9)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OpenBattlefield ->
            openBattlefield Nothing model

        BattleMsg Battle.Close ->
            ( { model | screen = Play }, Cmd.none )

        BattleMsg battleMsg ->
            case model.battlefield of
                Just battle ->
                    let
                        ( updated, command ) =
                            Battle.update battleMsg battle
                    in
                    ( { model | battlefield = Just updated }, Cmd.map BattleMsg command )

                Nothing ->
                    ( model, Cmd.none )

        SetupMsg Setup.StartWorld ->
            let
                setup =
                    model.setup
            in
            ( { model | setup = { setup | busy = True, error = Nothing } }
            , Api.createWorld model.apiBase setup.worldName setup.worldSeed setup.gridType GotWorld
            )

        SetupMsg Setup.ResumeSession ->
            case model.setup.resume of
                Just state ->
                    enterPlay state model

                Nothing ->
                    ( model, Cmd.none )

        SetupMsg Setup.ForgetSavedSession ->
            let
                ( setup, _ ) =
                    Setup.update Setup.ForgetSavedSession model.setup
            in
            ( { model | setup = setup, savedSessionId = Nothing }, forgetSession () )

        SetupMsg setupMsg ->
            let
                ( setup, _ ) =
                    Setup.update setupMsg model.setup
            in
            ( { model | setup = setup }, Cmd.none )

        GotWorld (Ok world) ->
            let
                setup =
                    model.setup
            in
            ( model
            , Api.createSession model.apiBase
                world.id
                setup.characterName
                setup.policyPreview
                setup.policyHistory
                GotSession
            )

        GotWorld (Err err) ->
            let
                setup =
                    model.setup
            in
            ( { model | setup = { setup | busy = False, error = Just (Api.errorToString err) } }, Cmd.none )

        GotSession (Ok state) ->
            enterPlay state model

        GotSession (Err err) ->
            let
                setup =
                    model.setup
            in
            ( { model | setup = { setup | busy = False, error = Just (Api.errorToString err) } }, Cmd.none )

        GotSavedSession (Ok state) ->
            let
                setup =
                    model.setup
            in
            ( { model | setup = { setup | resume = Just state, resumeError = Nothing } }, Cmd.none )

        GotSavedSession (Err _) ->
            let
                setup =
                    model.setup
            in
            ( { model
                | setup =
                    { setup
                        | resume = Nothing
                        , resumeError = Just "A saved adventure was found but could not be loaded from this server. Forget it and start fresh, or start the server it belongs to."
                    }
              }
            , Cmd.none
            )

        GotSessionState (Ok state) ->
            ( { model | session = Just state }, Cmd.none )

        GotSessionState (Err _) ->
            ( model, Cmd.none )

        GotMap (Ok data) ->
            ( { model | mapData = Just data }, Cmd.none )

        GotMap (Err err) ->
            ( { model | error = Just (Api.errorToString err) }, Cmd.none )

        GotHistory (Ok history) ->
            ( { model | log = history.entries }, scrollJournal )

        GotHistory (Err _) ->
            ( model, Cmd.none )

        TravelTo to ->
            case model.session of
                Just state ->
                    if model.busy || model.fixtureMode || state.session.pendingEncounter /= Nothing then
                        ( model, Cmd.none )

                    else
                        ( { model
                            | busy = True
                            , commandCounter = model.commandCounter + 1
                            , hoveredHex = Nothing
                            , tooltipHex = Nothing
                            , hoverToken = model.hoverToken + 1
                          }
                        , Api.travel model.apiBase
                            state.session.id
                            ("web-travel-" ++ String.fromInt (model.commandCounter + 1))
                            state.session.version
                            to
                            GotCommand
                        )

                Nothing ->
                    ( model, Cmd.none )

        ChooseOption choiceId ->
            case model.session of
                Just state ->
                    if model.busy || model.fixtureMode then
                        ( model, Cmd.none )

                    else
                        let
                            counter =
                                model.commandCounter + 1

                            wantsBattlefield =
                                opensBattlefield state.session.pendingEncounter choiceId

                            ( opened, openCmd ) =
                                if wantsBattlefield then
                                    openBattlefield (opponentLabel state.session.pendingEncounter) model

                                else
                                    ( model, Cmd.none )
                        in
                        ( { opened | busy = True, commandCounter = counter }
                        , Cmd.batch
                            [ Api.encounterAction model.apiBase
                                state.session.id
                                ("web-action-" ++ String.fromInt counter)
                                state.session.version
                                choiceId
                                GotCommand
                            , openCmd
                            ]
                        )

                Nothing ->
                    ( model, Cmd.none )

        GotCommand (Ok response) ->
            let
                newSession =
                    Maybe.map
                        (\s ->
                            let
                                sess =
                                    s.session
                            in
                            { s
                                | session =
                                    { sess
                                        | version = response.session.version
                                        , position = response.session.position
                                        , pendingEncounter = response.session.pendingEncounter
                                    }
                                , worldTick = response.worldTick
                            }
                        )
                        model.session

                moved =
                    case ( model.session, newSession ) of
                        ( Just before, Just after ) ->
                            before.session.position /= after.session.position

                        _ ->
                            False
            in
            ( { model
                | busy = False
                , session = newSession
                , lastResolution = Just response.resolution
                , spotlightDismissed = False
                , positionFlash = moved
              }
            , Cmd.batch
                [ Api.getMap model.apiBase response.session.id GotMap
                , Api.getHistory model.apiBase response.session.id GotHistory
                , Api.getSessionState model.apiBase response.session.id GotSessionState
                , scrollJournal
                , if moved then
                    Task.perform (\_ -> ClearPositionFlash) (Process.sleep 900)

                  else
                    Cmd.none
                ]
            )

        GotCommand (Err err) ->
            ( { model | busy = False, error = Just (Api.errorToString err) }
            , case model.session of
                Just state ->
                    Api.getSessionState model.apiBase state.session.id GotSessionState

                Nothing ->
                    Cmd.none
            )

        SelectHex at ->
            case model.session of
                Just state ->
                    ( model, Api.getHexDetail model.apiBase state.session.id at GotHexDetail )

                Nothing ->
                    ( model, Cmd.none )

        GotHexDetail (Ok detail) ->
            ( { model | selected = Just detail, panelTab = TabInspector }, Cmd.none )

        GotHexDetail (Err err) ->
            ( { model | selected = Nothing, error = Just (Api.errorToString err) }, Cmd.none )

        HoverHex at ->
            let
                token =
                    model.hoverToken + 1
            in
            ( { model | hoveredHex = Just at, hoverToken = token, tooltipHex = Nothing }
            , Task.perform (\_ -> ShowTooltip token at) (Process.sleep 500)
            )

        HoverEnd ->
            ( { model
                | hoveredHex = Nothing
                , hoverToken = model.hoverToken + 1
                , tooltipHex = Nothing
              }
            , Cmd.none
            )

        ShowTooltip token at ->
            if token == model.hoverToken && model.hoveredHex == Just at then
                ( { model | tooltipHex = Just at }, Cmd.none )

            else
                ( model, Cmd.none )

        NoOp ->
            ( model, Cmd.none )

        SetViewMode mode ->
            ( { model | viewMode = mode }, Cmd.none )

        SetMode PlayMode ->
            ( { model | mode = PlayMode }, Cmd.none )

        SetMode BuildMode ->
            case ( model.session, model.build ) of
                ( Just state, Nothing ) ->
                    let
                        ( build, command ) =
                            Build.init
                                { apiBase = model.apiBase
                                , sessionId = state.session.id
                                , policy = state.session.creatorPolicy
                                , readOnly = model.fixtureMode
                                }
                    in
                    ( { model | mode = BuildMode, build = Just build }, Cmd.map BuildMsg command )

                ( Just _, Just _ ) ->
                    ( { model | mode = BuildMode }, Cmd.none )

                ( Nothing, _ ) ->
                    ( model, Cmd.none )

        SetPanelTab tab ->
            ( { model | panelTab = tab }
            , if tab == TabJournal then
                scrollJournal

              else
                Cmd.none
            )

        DismissSpotlight ->
            ( { model | spotlightDismissed = True }, Cmd.none )

        ClearPositionFlash ->
            ( { model | positionFlash = False }, Cmd.none )

        CycleReachable step ->
            case model.session of
                Just state ->
                    let
                        count =
                            List.length state.reachable

                        next =
                            if count == 0 then
                                0

                            else
                                modBy count (model.focusIndex + step)
                    in
                    ( { model | focusIndex = next }, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )

        TravelToFocused ->
            case model.session of
                Just state ->
                    case List.drop model.focusIndex state.reachable |> List.head of
                        Just target ->
                            update (TravelTo target) model

                        Nothing ->
                            ( model, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )

        KeyDown key ->
            if model.screen /= Play || model.busy then
                ( model, Cmd.none )

            else
                case model.mode of
                    BuildMode ->
                        case key of
                            "p" ->
                                update (SetMode PlayMode) model

                            "Escape" ->
                                update (SetMode PlayMode) model

                            _ ->
                                ( model, Cmd.none )

                    PlayMode ->
                        case key of
                            "ArrowRight" ->
                                update (CycleReachable 1) model

                            "ArrowUp" ->
                                update (CycleReachable 1) model

                            "ArrowLeft" ->
                                update (CycleReachable -1) model

                            "ArrowDown" ->
                                update (CycleReachable -1) model

                            "Enter" ->
                                update TravelToFocused model

                            "m" ->
                                update (SetViewMode MapMode) model

                            "l" ->
                                update (SetViewMode ListMode) model

                            "b" ->
                                update (SetMode BuildMode) model

                            _ ->
                                ( model, Cmd.none )

        BuildMsg buildMsg ->
            case model.build of
                Just build ->
                    let
                        ( updated, command ) =
                            Build.update buildMsg build
                    in
                    ( { model | build = Just updated }, Cmd.map BuildMsg command )

                Nothing ->
                    ( model, Cmd.none )

        Refresh ->
            case model.session of
                Just state ->
                    ( model
                    , Cmd.batch
                        [ Api.getSessionState model.apiBase state.session.id GotSessionState
                        , Api.getMap model.apiBase state.session.id GotMap
                        , Api.getHistory model.apiBase state.session.id GotHistory
                        , scrollJournal
                        ]
                    )

                Nothing ->
                    ( model, Cmd.none )

        DismissError ->
            ( { model | error = Nothing }, Cmd.none )


{-| Open the battlefield sandbox for the current world space. When `enemy` is
given (a combat encounter chose to fight), the battlefield places a matching
enemy token on its own once the board loads.
-}
openBattlefield : Maybe String -> Model -> ( Model, Cmd Msg )
openBattlefield enemy model =
    case model.session of
        Just state ->
            if model.busy || model.fixtureMode then
                ( model, Cmd.none )

            else
                let
                    ( battle, command ) =
                        Battle.init model.apiBase state.session.id state.session.position enemy
                in
                ( { model
                    | battlefield = Just battle
                    , screen = BattlefieldScreen
                    , mode = PlayMode
                    , tooltipHex = Nothing
                    , hoveredHex = Nothing
                    , hoverToken = model.hoverToken + 1
                  }
                , Cmd.map BattleMsg command
                )

        Nothing ->
            ( model, Cmd.none )


{-| Whether the given choice opens the battlefield. This is declared by the
content table, not inferred from the choice's id, so renaming or adding a
combat choice is a content change.
-}
opensBattlefield : Maybe PendingEncounter -> String -> Bool
opensBattlefield pending choiceId =
    pending
        |> Maybe.map .choices
        |> Maybe.withDefault []
        |> List.any
            (\choice ->
                choice.id == choiceId && choice.presentation == Just Battlefield
            )


{-| Display name of the antagonists of a pending encounter, as authored in the
table result. Never derived by parsing the asset reference.
-}
opponentLabel : Maybe PendingEncounter -> Maybe String
opponentLabel pending =
    pending
        |> Maybe.map .assetLabel
        |> Maybe.withDefault (Just "Enemies")


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.screen == Play then
        Browser.Events.onKeyDown keyDecoder

    else
        Sub.none


keyDecoder : Decode.Decoder Msg
keyDecoder =
    Decode.map2 Tuple.pair
        (Decode.field "key" Decode.string)
        (Decode.at [ "target", "tagName" ] Decode.string)
        |> Decode.andThen
            (\( key, tag ) ->
                if tag == "INPUT" || tag == "TEXTAREA" || tag == "SELECT" then
                    Decode.fail "typing in a form field"

                else
                    Decode.succeed (KeyDown key)
            )


view : Model -> Html Msg
view model =
    case model.screen of
        Setup ->
            Html.map SetupMsg (Setup.view model.setup)

        Play ->
            Play.playView model

        BattlefieldScreen ->
            case model.battlefield of
                Just battle ->
                    Html.map BattleMsg (Battle.view battle)

                Nothing ->
                    Play.playView model
