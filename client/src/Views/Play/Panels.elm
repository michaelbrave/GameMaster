module Views.Play.Panels exposing (panelTabs)

{-| The lower side panel: the journal (default, follows the newest entries),
the hex inspector, and the resolution trace.
-}

import Html exposing (Html, button, div, h2, h3, li, ol, p, section, span, text, ul)
import Html.Attributes exposing (attribute, class, id)
import Html.Events exposing (onClick)
import State exposing (..)
import Types exposing (..)
import Util exposing (ifThen)


panelTabs : Model -> Html Msg
panelTabs model =
    let
        tabButton tab label =
            button
                [ onClick (SetPanelTab tab)
                , class (ifThen (model.panelTab == tab) "tab active" "tab")
                , attribute "role" "tab"
                , attribute "aria-selected" (ifThen (model.panelTab == tab) "true" "false")
                ]
                [ text label ]
    in
    section [ class "panel-region", attribute "aria-label" "Journal and details" ]
        [ div [ class "tabs", attribute "role" "tablist" ]
            [ tabButton TabJournal "Journal"
            , tabButton TabInspector "Inspector"
            , tabButton TabTrace "Trace"
            ]
        , case model.panelTab of
            TabJournal ->
                logView model

            TabInspector ->
                hexInspector model

            TabTrace ->
                resolutionTrace model
        ]


hexInspector : Model -> Html Msg
hexInspector model =
    case model.selected of
        Nothing ->
            p [ class "hint" ] [ text "Right-click a visited space (or use Inspect in the list) to see its terrain, sites, facts, and history here." ]

        Just detail ->
            section [ class "inspector", attribute "aria-label" "Hex inspector" ]
                [ h2 [] [ text ("Space " ++ String.fromInt detail.hex.q ++ "," ++ String.fromInt detail.hex.r ++ " — " ++ detail.hex.terrainLabel) ]
                , if List.isEmpty detail.hex.sites then
                    text ""

                  else
                    p [] [ text ("Sites: " ++ (detail.hex.sites |> List.map .name |> String.join ", ")) ]
                , if List.isEmpty detail.hex.facts then
                    text ""

                  else
                    p []
                        [ text
                            ("Active facts: "
                                ++ (detail.hex.facts
                                        |> List.map (\f -> String.replace "_" " " f.category ++ " (since tick " ++ String.fromInt f.createdTick ++ ")")
                                        |> String.join ", "
                                   )
                            )
                        ]
                , if List.isEmpty detail.history then
                    text ""

                  else
                    div []
                        [ h3 [] [ text "What happened here" ]
                        , ul [ class "hex-history" ]
                            (List.map (\e -> li [] [ text ("[" ++ String.fromInt e.tick ++ "] " ++ e.text) ]) detail.history)
                        ]
                ]


resolutionTrace : Model -> Html Msg
resolutionTrace model =
    case model.lastResolution of
        Nothing ->
            p [ class "hint" ] [ text "After an action or encounter choice, its resolution trace — every roll and table consulted — appears here." ]

        Just res ->
            section [ class "trace", attribute "aria-label" "Resolution trace" ]
                [ Html.node "details"
                    []
                    [ Html.node "summary"
                        []
                        [ text ("How the last action resolved (" ++ res.outcome ++ ", tick " ++ String.fromInt res.worldTick ++ ")") ]
                    , ul [ class "trace-rolls" ]
                        (List.map rollRow res.rolls)
                    ]
                ]


rollRow : RollRecord -> Html Msg
rollRow roll =
    let
        selectionText =
            case roll.selection of
                Weighted w ->
                    "weighted roll " ++ String.fromInt w.roll ++ " of " ++ String.fromInt w.totalWeight

                DiceRolled d ->
                    "rolled "
                        ++ d.expr
                        ++ " = ["
                        ++ (d.dice |> List.map String.fromInt |> String.join ", ")
                        ++ "] → "
                        ++ String.fromInt d.total

        nestedNote =
            if roll.depth > 0 then
                " (nested, depth " ++ String.fromInt roll.depth ++ ")"

            else
                ""
    in
    li []
        [ text
            (roll.label
                ++ ": "
                ++ selectionText
                ++ " → "
                ++ roll.selectedEntryId
                ++ " — “"
                ++ roll.text
                ++ "”"
                ++ nestedNote
            )
        ]


logView : Model -> Html Msg
logView model =
    section [ class "log", attribute "aria-label" "World journal" ]
        [ h2 [] [ text "Journal" ]
        , p [ class "hint" ] [ text "Newest entries at the bottom — the view follows the latest events." ]
        , ol [ class "log-entries", id "journal-log", attribute "aria-live" "polite" ]
            (List.map
                (\entry ->
                    li [ class "log-entry" ]
                        [ span [ class "log-tick" ] [ text ("t" ++ String.fromInt entry.tick) ]
                        , span [ class "log-text" ] [ text entry.text ]
                        ]
                )
                model.log
            )
        ]
