module Views.Play.Map exposing (mapView, markerGlyph)

{-| The SVG world map: board backdrop, reachable/known spaces, position
marker, hover tooltip, and the terrain legend. Pure view code over the shared
play Model; all behavior arrives as Msgs defined in State.
-}

import BoardGrid
import Dict
import Html exposing (Attribute, Html, div, li, p, span, text, ul)
import Html.Attributes exposing (attribute, class, style)
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
