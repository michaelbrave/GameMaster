module Setup exposing (Model, Msg(..), init, update, view)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onCheck, onClick, onInput)
import Types exposing (SessionState)
import Util exposing (ifThen)
import Views.Components as Components


{-| Setup screen state: the new-world form plus (when a session id was saved by
a previous visit) a resume card fetched from the server. Owns its own update so
the main model does not carry form fields.
-}
type alias Model =
    { worldName : String
    , gridType : String
    , worldSeed : String
    , characterName : String
    , policyPreview : Bool
    , policyHistory : Bool
    , busy : Bool
    , resume : Maybe SessionState
    , resumeError : Maybe String
    , error : Maybe String
    }


init : Model
init =
    { worldName = "First Crossing"
    , gridType = "square-diamond"
    , worldSeed = "demo-16"
    , characterName = "Wren"
    , policyPreview = True
    , policyHistory = True
    , busy = False
    , resume = Nothing
    , resumeError = Nothing
    , error = Nothing
    }


type Msg
    = WorldNameChanged String
    | GridTypeChanged String
    | WorldSeedChanged String
    | CharacterNameChanged String
    | TogglePolicyPreview Bool
    | TogglePolicyHistory Bool
    | StartWorld
    | ResumeSession
    | ForgetSavedSession
    | DismissError


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        WorldNameChanged value ->
            ( { model | worldName = value }, Cmd.none )

        GridTypeChanged value ->
            ( { model | gridType = value }, Cmd.none )

        WorldSeedChanged value ->
            ( { model | worldSeed = value }, Cmd.none )

        CharacterNameChanged value ->
            ( { model | characterName = value }, Cmd.none )

        TogglePolicyPreview value ->
            ( { model | policyPreview = value }, Cmd.none )

        TogglePolicyHistory value ->
            ( { model | policyHistory = value }, Cmd.none )

        -- The remaining messages are handled by Main (they start HTTP work).
        StartWorld ->
            ( { model | busy = True, error = Nothing }, Cmd.none )

        ResumeSession ->
            ( { model | busy = True, error = Nothing }, Cmd.none )

        ForgetSavedSession ->
            ( { model | resume = Nothing, resumeError = Nothing, error = Nothing }, Cmd.none )

        DismissError ->
            ( { model | error = Nothing }, Cmd.none )


view : Model -> Html Msg
view model =
    main_ [ class "setup" ]
        [ h1 [] [ text "Worldforge" ]
        , p [ class "tagline" ] [ text "A persistent world for tabletop adventures. Consequences remember you." ]
        , resumeCard model
        , Html.form [ class "setup-form" ]
            [ label []
                [ text "World name"
                , input [ value model.worldName, onInput WorldNameChanged, disabled model.busy ] []
                ]
            , label []
                [ text "Board layout"
                , select [ onInput GridTypeChanged, disabled model.busy, value model.gridType ]
                    [ option [ value "square-diamond", selected (model.gridType == "square-diamond") ] [ text "Square grid with corner diamonds" ]
                    , option [ value "hex", selected (model.gridType == "hex") ] [ text "Hex grid" ]
                    ]
                , p [ class "hint" ] [ text "Square grid: cardinal travel takes one step. Diagonal travel stops on a corner diamond, then takes a second step to the next large tile. Terrain still determines travel time." ]
                ]
            , label []
                [ text "World seed (same seed and layout, same world)"
                , input [ value model.worldSeed, onInput WorldSeedChanged, disabled model.busy ] []
                ]
            , label []
                [ text "Character name"
                , input [ value model.characterName, onInput CharacterNameChanged, disabled model.busy ] []
                ]
            , fieldset []
                [ legend [] [ text "Build mode access (session visibility policy)" ]
                , label [ class "check" ]
                    [ input [ type_ "checkbox", checked model.policyPreview, onCheck TogglePolicyPreview ] []
                    , text "Roll-table preview & publishing"
                    ]
                , label [ class "check" ]
                    [ input [ type_ "checkbox", checked model.policyHistory, onCheck TogglePolicyHistory ] []
                    , text "Complete-history inspection"
                    ]
                , p [ class "hint" ] [ text "These gate the Build mode tools; the server enforces them either way." ]
                ]
            , button
                [ type_ "button", onClick StartWorld, disabled model.busy, class "primary" ]
                [ text (ifThen model.busy "Creating world…" "Create world & play") ]
            ]
        , Components.errorBanner DismissError model.error
        ]


resumeCard : Model -> Html Msg
resumeCard model =
    case ( model.resume, model.resumeError ) of
        ( Just state, _ ) ->
            section [ class "resume-card", attribute "aria-label" "Continue adventure" ]
                [ h2 [] [ text "Continue your adventure" ]
                , p []
                    [ text
                        (state.session.characterName
                            ++ " in "
                            ++ state.worldName
                            ++ " · tick "
                            ++ String.fromInt state.worldTick
                            ++ " · "
                            ++ String.fromInt state.discoveredCount
                            ++ " spaces discovered"
                        )
                    ]
                , div [ class "choices" ]
                    [ button [ onClick ResumeSession, disabled model.busy, class "primary" ] [ text "Continue" ]
                    , button [ onClick ForgetSavedSession, disabled model.busy ] [ text "Forget this save" ]
                    ]
                ]

        ( Nothing, Just message ) ->
            section [ class "resume-card", attribute "aria-label" "Continue adventure" ]
                [ h2 [] [ text "Saved adventure" ]
                , p [ class "hint" ] [ text message ]
                , div [ class "choices" ]
                    [ button [ onClick ForgetSavedSession ] [ text "Forget this save" ] ]
                ]

        _ ->
            text ""
