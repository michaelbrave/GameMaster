module Views.Play exposing (playView)

import BoardGrid
import Build
import Dict
import Html exposing (..)
import Html.Attributes as Attr exposing (..)
import Html.Events exposing (onClick, onMouseEnter, onMouseLeave)
import Json.Decode as Decode
import State exposing (..)
import Svg exposing (circle, polygon, svg, text_)
import Svg.Attributes as SvgAttr
import Types exposing (..)
import Util exposing (ifThen)


{-| Right-click (contextmenu) handler that suppresses the browser menu.
-}
onRightClick : Msg -> Attribute Msg
onRightClick msg =
    Html.Events.custom "contextmenu"
        (Decode.succeed { message = msg, stopPropagation = True, preventDefault = True })


playView : Model -> Html Msg
playView model =
    main_ [ class "layout" ]
        ([ headerView model
         , errorBanner model
         ]
            ++ (if model.mode == BuildMode then
                    [ buildArea model ]

                else
                    [ playArea model ]
               )
            ++ encounterSpotlight model
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


errorBanner : Model -> Html Msg
errorBanner model =
    case model.error of
        Nothing ->
            text ""

        Just message ->
            div [ class "error-banner", attribute "role" "alert" ]
                [ span [] [ text message ]
                , button [ onClick DismissError, attribute "aria-label" "Dismiss" ] [ text "×" ]
                ]


playArea : Model -> Html Msg
playArea model =
    div [ class "play-area" ]
        [ section [ class "map-panel", attribute "aria-label" "World map" ]
            [ case model.viewMode of
                MapMode ->
                    mapView model

                ListMode ->
                    listView model
            ]
        , aside [ class "side-panel" ]
            [ section []
                [ h2 [] [ text "Tactical view" ]
                , button [ onClick OpenBattlefield, disabled (model.busy || model.fixtureMode || model.session == Nothing), class "primary" ] [ text "Open battlefield" ]
                , p [ class "hint" ] [ text "Explore the current world space at token scale. Place characters, enemies, objects, and obstacles. Choosing Fight on a combat encounter opens this board with the enemies already placed." ]
                ]
            , encounterPanel model
            , travelControls model
            , panelTabs model
            ]
        ]


{-| The lower side panel: the journal (default, follows the newest entries),
the hex inspector, and the resolution trace.
-}
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


{-| Spotlight dialog for a pending encounter: the dramatic beat of the loop,
front and center until the choice is made (or minimized).
-}
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
                        , div [ class "choices" ]
                            (List.map
                                (\choice ->
                                    button
                                        [ onClick (ChooseOption choice.id)
                                        , disabled model.busy
                                        , class "choice primary"
                                        ]
                                        [ text choice.label ]
                                )
                                pending.choices
                            )
                        , p [ class "hint" ] [ text "Choose an option to resolve it. Fight opens the battlefield with these foes placed." ]
                        , button [ onClick DismissSpotlight, class "spotlight-minimize" ] [ text "Minimize for now" ]
                        ]
                    ]
                ]

        Nothing ->
            []


markerGlyph : String -> String
markerGlyph icon =
    case icon of
        "icon:ruin" ->
            "♜"

        "icon:stones" ->
            "◆"

        "icon:shrine" ->
            "†"

        "icon:remains" ->
            "✚"

        "icon:bones" ->
            "≡"

        "icon:scavenger" ->
            "▽"

        "icon:undead" ->
            "☠"

        "icon:haunting" ->
            "◌"

        "icon:bandits" ->
            "⚔"

        "icon:beast" ->
            "♞"

        _ ->
            "•"


mapView : Model -> Html Msg
mapView model =
    case ( model.session, model.mapData ) of
        ( Just state, Just data ) ->
            let
                discovered =
                    data.hexes

                isDiscovered h =
                    List.any (\x -> x.q == h.q && x.r == h.r) discovered

                unknownReachable =
                    List.filter (\h -> not (isDiscovered h)) data.reachable

                focused =
                    List.drop model.focusIndex state.reachable |> List.head
            in
            div [ class "map-wrap" ]
                [ svg
                    [ SvgAttr.viewBox (BoardGrid.viewBoxFor data.gridType data.regionRadius)
                    , SvgAttr.class "hex-map"
                    , attribute "role" "img"
                    , attribute "aria-label"
                        "World map. Discovered spaces show terrain and markers; dashed spaces are reachable."
                    ]
                    (boardBackdrop data
                        ++ List.map (reachableHexSvg data.gridType focused model.busy model.fixtureMode (state.session.pendingEncounter /= Nothing)) unknownReachable
                        ++ List.map (knownHexSvg data) discovered
                        ++ [ positionMarker model.positionFlash data, hexTooltip model data ]
                    )
                , legendView data
                ]

        _ ->
            case model.error of
                Just message ->
                    p [ class "hint" ] [ text ("Map could not load: " ++ message) ]

                Nothing ->
                    p [] [ text "Loading map…" ]


{-| Compact terrain legend so map colors and glyphs are learnable at a glance.
-}
legendView : MapData -> Html Msg
legendView data =
    let
        entries =
            data.legend
                |> Dict.toList
                |> List.sortBy (Tuple.second >> .label)
    in
    Html.node "details"
        [ class "legend" ]
        [ Html.node "summary" [] [ text "Terrain legend" ]
        , ul [ class "legend-list" ]
            (List.map
                (\( _, l ) ->
                    li [ class "legend-row" ]
                        [ span [ class "legend-swatch", style "background" l.color ] [ text l.glyph ]
                        , span [] [ text l.label ]
                        , span [ class "hint" ]
                            [ text
                                (if l.passable then
                                    "· " ++ String.fromInt l.moveCost ++ " ticks"

                                 else
                                    "· impassable"
                                )
                            ]
                        ]
                )
                entries
            )
        ]


boardBackdrop : MapData -> List (Svg.Svg Msg)
boardBackdrop data =
    if data.gridType /= "square-diamond" then
        []

    else
        List.range (-2 * data.regionRadius) (2 * data.regionRadius)
            |> List.concatMap
                (\r ->
                    List.range (-2 * data.regionRadius) (2 * data.regionRadius)
                        |> List.filter (\q -> modBy 2 q == modBy 2 r)
                        |> List.map
                            (\q ->
                                polygon
                                    [ SvgAttr.points (BoardGrid.points data.gridType { q = q, r = r })
                                    , SvgAttr.fill "#20252b"
                                    , SvgAttr.stroke "#444b55"
                                    , SvgAttr.strokeWidth "1"
                                    , SvgAttr.opacity "0.45"
                                    , SvgAttr.pointerEvents "none"
                                    ]
                                    []
                            )
                )


reachableHexSvg : String -> Maybe Axial -> Bool -> Bool -> Bool -> Axial -> Svg.Svg Msg
reachableHexSvg grid focused busy fixtureMode pendingEncounter h =
    let
        ( cx, cy ) =
            BoardGrid.pixelFor grid h

        isFocused =
            focused |> Maybe.map (\f -> f.q == h.q && f.r == h.r) |> Maybe.withDefault False
    in
    Svg.g
        ([ SvgAttr.class (ifThen (BoardGrid.isDiamond grid h) "hex reachable diamond" "hex reachable")
         , attribute "role" "button"
         , attribute "tabindex" "0"
         , attribute "aria-label"
            ("Travel to unexplored space " ++ String.fromInt h.q ++ "," ++ String.fromInt h.r)
         , onRightClick NoOp
         , onMouseEnter (HoverHex h)
         , onMouseLeave HoverEnd
         ]
            ++ (if pendingEncounter then
                    []

                else
                    [ onClick (TravelTo h) ]
               )
        )
        [ polygon
            [ SvgAttr.points (BoardGrid.points grid h)
            , SvgAttr.class (ifThen isFocused "hex-shape unknown focused" "hex-shape unknown")
            ]
            []
        , text_
            [ SvgAttr.x (String.fromFloat cx), SvgAttr.y (String.fromFloat (cy + 5)), SvgAttr.class "hex-glyph unknown-glyph" ]
            [ Svg.text "?" ]
        ]


knownHexSvg : MapData -> HexSummary -> Svg.Svg Msg
knownHexSvg data hex =
    let
        ( cx, cy ) =
            BoardGrid.pixelFor data.gridType { q = hex.q, r = hex.r }

        terrain =
            Dict.get hex.terrain data.legend

        fill =
            terrain |> Maybe.map .color |> Maybe.withDefault "#444"

        glyph =
            terrain |> Maybe.map .glyph |> Maybe.withDefault "?"

        markerText =
            hex.markers |> List.map (\m -> markerGlyph m.icon) |> String.join " "

        markerLabels =
            hex.markers |> List.map .label |> String.join ", "

        isPosition =
            data.position.q == hex.q && data.position.r == hex.r

        isReachable =
            List.any (\x -> x.q == hex.q && x.r == hex.r) data.reachable

        at =
            { q = hex.q, r = hex.r }

        actionHint =
            if isReachable then
                ". Left-click to travel here, right-click for details"

            else
                ". Right-click for details"
    in
    Svg.g
        [ SvgAttr.class (ifThen (BoardGrid.isDiamond data.gridType at) "hex known diamond" "hex known")
        , attribute "role" "button"
        , attribute "tabindex" "0"
        , attribute "aria-label"
            (hex.terrainLabel
                ++ " "
                ++ String.fromInt hex.q
                ++ ","
                ++ String.fromInt hex.r
                ++ ifThen (markerLabels == "") "" (". Markers: " ++ markerLabels)
                ++ actionHint
            )
        , onClick
            (if isReachable then
                TravelTo at

             else
                SelectHex at
            )
        , onRightClick (SelectHex at)
        , onMouseEnter (HoverHex at)
        , onMouseLeave HoverEnd
        ]
        ([ polygon
            [ SvgAttr.points (BoardGrid.points data.gridType at)
            , SvgAttr.class (ifThen isPosition "hex-shape current" "hex-shape")
            , SvgAttr.fill fill
            ]
            []
         , text_
            [ SvgAttr.x (String.fromFloat cx), SvgAttr.y (String.fromFloat (cy - 4)), SvgAttr.class "hex-glyph" ]
            [ Svg.text glyph ]
         ]
            ++ (if markerText == "" || BoardGrid.isDiamond data.gridType at then
                    []

                else
                    [ text_
                        [ SvgAttr.x (String.fromFloat cx), SvgAttr.y (String.fromFloat (cy + 14)), SvgAttr.class "hex-markers" ]
                        [ Svg.text markerText ]
                    ]
               )
        )


positionMarker : Bool -> MapData -> Svg.Svg Msg
positionMarker flash data =
    let
        ( cx, cy ) =
            BoardGrid.pixelFor data.gridType data.position
    in
    circle
        [ SvgAttr.cx (String.fromFloat cx)
        , SvgAttr.cy (String.fromFloat cy)
        , SvgAttr.r "6"
        , SvgAttr.class (ifThen flash "position-dot flash" "position-dot")
        ]
        []


{-| Hover tooltip for the hex under the cursor (shown after a short delay).
Rendered as an SVG overlay on top of the map; pointer-events are disabled in
CSS so it never steals hover from the hexes beneath it.
-}
hexTooltip : Model -> MapData -> Svg.Svg Msg
hexTooltip model data =
    case model.tooltipHex of
        Nothing ->
            Svg.g [] []

        Just at ->
            let
                knownHex =
                    data.hexes
                        |> List.filter (\h -> h.q == at.q && h.r == at.r)
                        |> List.head

                isReachable =
                    List.any (\x -> x.q == at.q && x.r == at.r) data.reachable

                coordText =
                    "(" ++ String.fromInt at.q ++ "," ++ String.fromInt at.r ++ ")"

                lines =
                    case knownHex of
                        Just hex ->
                            tooltipLinesKnown data hex isReachable coordText

                        Nothing ->
                            if isReachable then
                                [ ( "tt-title", "Unexplored " ++ coordText )
                                , ( "tt-hint", "Left-click: travel into the unknown" )
                                ]

                            else
                                [ ( "tt-title", "Unknown " ++ coordText ) ]
            in
            if knownHex == Nothing && not isReachable then
                Svg.g [] []

            else
                tooltipBox data at lines


tooltipLinesKnown : MapData -> HexSummary -> Bool -> String -> List ( String, String )
tooltipLinesKnown data hex isReachable coordText =
    let
        legend =
            Dict.get hex.terrain data.legend

        terrainLine =
            case legend of
                Just l ->
                    if l.passable then
                        "Move cost " ++ String.fromInt l.moveCost

                    else
                        "Impassable"

                Nothing ->
                    ""

        isCurrent =
            data.position.q == hex.q && data.position.r == hex.r

        detailLine =
            [ terrainLine, ifThen isCurrent "you are here" "" ]
                |> List.filter (\s -> s /= "")
                |> String.join " · "

        markerLine =
            if List.isEmpty hex.markers then
                ""

            else
                "Markers: " ++ (hex.markers |> List.map .label |> String.join ", ")

        siteLine =
            if List.isEmpty hex.sites then
                ""

            else
                "Sites: " ++ (hex.sites |> List.map .name |> String.join ", ")

        hintLine =
            if isReachable then
                "Left-click: travel · Right-click: details"

            else
                "Right-click: details"
    in
    ( "tt-title", hex.terrainLabel ++ " " ++ coordText )
        :: List.map (\s -> ( "tt-line", s ))
            (List.filter (\s -> s /= "") [ detailLine, markerLine, siteLine ])
        ++ [ ( "tt-hint", hintLine ) ]


tooltipBox : MapData -> Axial -> List ( String, String ) -> Svg.Svg Msg
tooltipBox data at lines =
    let
        ( cx, cy ) =
            BoardGrid.pixelFor data.gridType at

        lineHeight =
            14

        boxHeight =
            toFloat (List.length lines * lineHeight + 10)

        maxLen =
            lines
                |> List.map (Tuple.second >> String.length)
                |> List.maximum
                |> Maybe.withDefault 10

        boxWidth =
            toFloat (maxLen * 6 + 16)

        edge =
            BoardGrid.topEdgeFor data.gridType data.regionRadius

        -- Prefer above the hex; flip below when there is no room.
        boxTop =
            if cy - 42 - boxHeight < edge + 4 then
                cy + 42

            else
                cy - 42 - boxHeight

        boxLeft =
            clamp (edge + 4) (-edge - boxWidth - 4) (cx - boxWidth / 2)
    in
    Svg.g [ SvgAttr.class "hex-tooltip" ]
        (Svg.rect
            [ SvgAttr.x (String.fromFloat boxLeft)
            , SvgAttr.y (String.fromFloat boxTop)
            , SvgAttr.width (String.fromFloat boxWidth)
            , SvgAttr.height (String.fromFloat boxHeight)
            , SvgAttr.class "hex-tooltip-box"
            ]
            []
            :: List.indexedMap
                (\i ( cls, line ) ->
                    text_
                        [ SvgAttr.x (String.fromFloat (boxLeft + 8))
                        , SvgAttr.y (String.fromFloat (boxTop + 14 + toFloat (i * lineHeight)))
                        , SvgAttr.class cls
                        ]
                        [ Svg.text line ]
                )
                lines
        )


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
                                            hex.markers |> List.map (\m -> markerGlyph m.icon ++ " " ++ m.label) |> String.join "; "
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


encounterPanel : Model -> Html Msg
encounterPanel model =
    case model.session |> Maybe.andThen (.session >> .pendingEncounter) of
        Nothing ->
            text ""

        Just pending ->
            section [ class "encounter", attribute "aria-label" "Encounter" ]
                [ h2 [] [ text "Encounter!" ]
                , p [ class "encounter-text" ] [ text pending.text ]
                , div [ class "choices" ]
                    (List.map
                        (\choice ->
                            button
                                [ onClick (ChooseOption choice.id), disabled (model.busy || model.fixtureMode), class "choice primary" ]
                                [ text choice.label ]
                        )
                        pending.choices
                    )
                ]


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
