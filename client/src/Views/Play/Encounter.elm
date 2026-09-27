module Views.Play.Encounter exposing (encounterPanel, encounterSpotlight)

{-| The pending-encounter UI: a spotlight dialog (the dramatic beat, front and
center until a choice is made or it is minimized) and the sidebar panel shown
when the spotlight is dismissed. Both presentations render the same choice
buttons so they can never drift apart.
-}

import Html exposing (Html, button, div, h2, p, section, text)
import Html.Attributes exposing (attribute, class, disabled)
import Html.Events exposing (onClick)
import State exposing (..)
import Types exposing (..)


{-| The encounter choice buttons. `isDisabled` differs per surface: the
spotlight blocks only while a command is in flight; the sidebar panel is also
inert in fixture (offline demo) mode.
-}
choiceButtons : Bool -> List Choice -> Html Msg
choiceButtons isDisabled choices =
    div [ class "choices" ]
        (List.map
            (\choice ->
                button
                    [ onClick (ChooseOption choice.id)
                    , disabled isDisabled
                    , class "choice primary"
                    ]
                    [ text choice.label ]
            )
            choices
        )


encounterSpotlight : Model -> List (Html Msg)
encounterSpotlight model =
    case model.session |> Maybe.andThen (.session >> .pendingEncounter) of
        Just pending ->
            if model.spotlightDismissed || model.fixtureMode then
                []

            else
                [ div [ class "spotlight-backdrop" ]
                    [ div [ class "spotlight", attribute "role" "dialog", attribute "aria-label" "Encounter" ]
                        [ h2 [] [ text "Encounter!" ]
                        , p [ class "encounter-text" ] [ text pending.text ]
                        , choiceButtons model.busy pending.choices
                        , p [ class "hint" ] [ text "Choose an option to resolve it. Fight opens the battlefield with these foes placed." ]
                        , button [ onClick DismissSpotlight, class "spotlight-minimize" ] [ text "Minimize for now" ]
                        ]
                    ]
                ]

        Nothing ->
            []


encounterPanel : Model -> Html Msg
encounterPanel model =
    case model.session |> Maybe.andThen (.session >> .pendingEncounter) of
        Nothing ->
            text ""

        Just pending ->
            section [ class "encounter", attribute "aria-label" "Encounter" ]
                [ h2 [] [ text "Encounter!" ]
                , p [ class "encounter-text" ] [ text pending.text ]
                , choiceButtons (model.busy || model.fixtureMode) pending.choices
                ]
