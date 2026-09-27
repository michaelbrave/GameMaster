module BoardGrid exposing (isDiamond, pixelFor, points, topEdgeFor, viewBoxFor)

import HexGrid
import Types exposing (Axial)


isDiamond : String -> Axial -> Bool
isDiamond grid at =
    grid == "square-diamond" && modBy 2 at.q == 1


pixelFor : String -> Axial -> ( Float, Float )
pixelFor grid at =
    if grid == "square-diamond" then
        ( toFloat at.q * 34, toFloat at.r * 34 )

    else
        HexGrid.pixelFor at


points : String -> Axial -> String
points grid at =
    let
        ( cx, cy ) =
            pixelFor grid at

        offsets =
            if isDiamond grid at then
                [ ( 0, -14 ), ( 14, 0 ), ( 0, 14 ), ( -14, 0 ) ]

            else
                [ ( -20, -34 )
                , ( 20, -34 )
                , ( 34, -20 )
                , ( 34, 20 )
                , ( 20, 34 )
                , ( -20, 34 )
                , ( -34, 20 )
                , ( -34, -20 )
                ]
    in
    if grid == "hex" then
        HexGrid.hexPoints ( cx, cy )

    else
        offsets
            |> List.map (\( x, y ) -> String.fromFloat (cx + x) ++ "," ++ String.fromFloat (cy + y))
            |> String.join " "


topEdgeFor : String -> Int -> Float
topEdgeFor grid radius =
    if grid == "square-diamond" then
        -(toFloat radius * 68 + 48)

    else
        HexGrid.topEdgeFor radius


viewBoxFor : String -> Int -> String
viewBoxFor grid radius =
    let
        lo =
            topEdgeFor grid radius
    in
    String.join " " (List.map String.fromFloat [ lo, lo, -2 * lo, -2 * lo ])
