module Views.Play exposing (playView)

{-| The play screen: topbar plus the map/list area and the side panel. The
SVG map lives in Views.Play.Map, the encounter spotlight/panel in
Views.Play.Encounter, and the journal/inspector/trace tabs in
Views.Play.Panels.
-}

import Build
import Dict
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onClick)
import State exposing (..)
import Util exposing (ifThen)
import Views.Components as Components
import Views.Play.Encounter as Encounter
import Views.Play.Map as Map
import Views.Play.Panels as Panels


playView : Model -> Html Msg
playView model =
    main_ [ class "layout" ]
        ([ headerView model
         , Components.errorBanner DismissError model.error
         ]
            ++ (if model.mode == BuildMode then
                    [ buildArea model ]

                else
                    [ playArea model ]
               )
            ++ Encounter.encounterSpotlight model
        )


buildArea : Model -> Html Msg
buildArea model =
    case model.build of
        Just build ->
            Html.map BuildMsg (Build.view build)

        Nothing ->
            p [ class "hint" ] [ text "Build tools need an active session." ]


headerView : Model -> Html Msg
headerView model =
    let
        state =
            model.session

        tick =
            state |> Maybe.map .worldTick |> Maybe.withDefault 0

        charName =
            state |> Maybe.map (.session >> .characterName) |> Maybe.withDefault "—"

        pos =
            state
                |> Maybe.map (.session >> .position)
                |> Maybe.map (\p -> String.fromInt p.q ++ "," ++ String.fromInt p.r)
                |> Maybe.withDefault "—"

        view =
            model.viewMode
    in
    header [ class "topbar" ]
        [ h1 [] [ text "Worldforge" ]
        , div [ class "world-clock", attribute "aria-label" "World clock" ]
            [ span [] [ text ("World tick " ++ String.fromInt tick) ]
            , span [ class "sep" ] [ text "·" ]
            , span [] [ text (charName ++ " at " ++ pos) ]
            ]
        , div [ class "mode-switch", attribute "role" "group", attribute "aria-label" "Mode" ]
            [ button
                [ onClick (SetMode PlayMode)
                , class (ifThen (model.mode == PlayMode) "active" "")
                , attribute "aria-pressed" (ifThen (model.mode == PlayMode) "true" "false")
                ]
                [ text "Play (p)" ]
            , button
                [ onClick (SetMode BuildMode)
                , class (ifThen (model.mode == BuildMode) "active" "")
                , attribute "aria-pressed" (ifThen (model.mode == BuildMode) "true" "false")
                ]
                [ text "Build tools (b)" ]
            ]
        , div [ class "topbar-actions", attribute "role" "group", attribute "aria-label" "View controls" ]
            [ button
                [ onClick (SetViewMode MapMode), class (ifThen (view == MapMode) "active" "") ]
                [ text "Map (m)" ]
            , button
                [ onClick (SetViewMode ListMode), class (ifThen (view == ListMode) "active" "") ]
                [ text "List (l)" ]
            , button [ onClick Refresh ] [ text "Refresh" ]
            ]
        ]


playArea : Model -> Html Msg
playArea model =
    div [ class "play-area" ]
        [ section [ class "map-panel", attribute "aria-label" "World map" ]
            [ case model.viewMode of
                MapMode ->
                    Map.mapView model

                ListMode ->
                    listView model
            ]
        , aside [ class "side-panel" ]
            [ section []
                [ h2 [] [ text "Tactical view" ]
                , button [ onClick OpenBattlefield, disabled (model.busy || model.fixtureMode || model.session == Nothing), class "primary" ] [ text "Open battlefield" ]
                , p [ class "hint" ] [ text "Explore the current world space at token scale. Place characters, enemies, objects, and obstacles. Choosing Fight on a combat encounter opens this board with the enemies already placed." ]
                ]
            , Encounter.encounterPanel model
            , travelControls model
            , Panels.panelTabs model
            ]
        ]


listView : Model -> Html Msg
listView model =
    case ( model.session, model.mapData ) of
        ( Just _, Just data ) ->
            let
                isReachable h =
                    List.any (\x -> x.q == h.q && x.r == h.r) data.reachable
            in
            div [ class "hex-list" ]
                [ p [ class "hint" ]
                    [ text "Accessible list equivalent of the map: every discovered space with the same information and travel actions." ]
                , ul []
                    (List.map
                        (\hex ->
                            li [ class "hex-row" ]
                                [ span [ class "hex-coord" ]
                                    [ text (String.fromInt hex.q ++ "," ++ String.fromInt hex.r) ]
                                , span [ class "hex-terrain" ]
                                    [ text (hex.terrainLabel ++ " (glyph " ++ (Dict.get hex.terrain data.legend |> Maybe.map .glyph |> Maybe.withDefault "?") ++ ")") ]
                                , span [ class "hex-markers-list" ]
                                    [ text
                                        (if List.isEmpty hex.markers then
                                            "no markers"

                                         else
                                            hex.markers |> List.map (\m -> Map.markerGlyph m.icon ++ " " ++ m.label) |> String.join "; "
                                        )
                                    ]
                                , if isReachable { q = hex.q, r = hex.r } && not model.busy && not model.fixtureMode then
                                    button [ onClick (TravelTo { q = hex.q, r = hex.r }) ] [ text "Travel here" ]

                                  else
                                    button [ onClick (SelectHex { q = hex.q, r = hex.r }) ] [ text "Inspect" ]
                                ]
                        )
                        data.hexes
                    )
                ]

        _ ->
            p [] [ text "Loading…" ]


travelControls : Model -> Html Msg
travelControls model =
    case model.session of
        Nothing ->
            text ""

        Just state ->
            let
                pending =
                    state.session.pendingEncounter /= Nothing

                terrainInfo h =
                    model.mapData
                        |> Maybe.andThen
                            (\data ->
                                data.hexes
                                    |> List.filter (\x -> x.q == h.q && x.r == h.r)
                                    |> List.head
                                    |> Maybe.andThen
                                        (\hex ->
                                            Dict.get hex.terrain data.legend
                                                |> Maybe.map (\l -> ( hex.terrainLabel, l.moveCost ))
                                        )
                            )

                targetLabel h =
                    terrainInfo h
                        |> Maybe.map
                            (\( label, cost ) ->
                                " (" ++ label ++ " · " ++ String.fromInt cost ++ " ticks)"
                            )
                        |> Maybe.withDefault " (unexplored)"
            in
            section [ class "travel-controls", attribute "aria-label" "Travel" ]
                [ h2 [] [ text "Travel" ]
                , if pending then
                    p [ class "hint" ] [ text "Resolve the encounter before traveling." ]

                  else
                    div []
                        [ ul [ class "reachable-list" ]
                            (List.indexedMap
                                (\i h ->
                                    li []
                                        [ button
                                            [ onClick (TravelTo h)
                                            , disabled (model.busy || model.fixtureMode)
                                            , class (ifThen (i == model.focusIndex) "focused-travel" "")
                                            ]
                                            [ text
                                                ("→ "
                                                    ++ String.fromInt h.q
                                                    ++ ","
                                                    ++ String.fromInt h.r
                                                    ++ targetLabel h
                                                )
                                            ]
                                        ]
                                )
                                state.reachable
                            )
                        , p [ class "hint" ]
                            [ text "Left-click a neighboring space to travel (or arrow keys + Enter). Right-click a visited space for details, hover any space for a peek. m = map, l = list, b = build tools." ]
                        ]
                ]
