module HexGrid exposing (cornerPoints, hexPoints, pixelFor, size, topEdgeFor, viewBoxFor)

import Types exposing (Axial)


{-| Pointy-top axial hex layout math (pure; mirrored in tests).
-}
size : Float
size =
    34


sqrt3 : Float
sqrt3 =
    1.7320508075688772


{-| Center pixel of a hex in pointy-top axial layout.
-}
pixelFor : Axial -> ( Float, Float )
pixelFor at =
    ( size * sqrt3 * (toFloat at.q + toFloat at.r / 2)
    , size * 1.5 * toFloat at.r
    )


{-| The six corner offsets of a pointy-top hex.
-}
cornerPoints : List ( Float, Float )
cornerPoints =
    List.range 0 5
        |> List.map
            (\i ->
                let
                    angleDeg =
                        60 * toFloat i - 30

                    angleRad =
                        angleDeg * pi / 180
                in
                ( size * cos angleRad, size * sin angleRad )
            )


{-| SVG "points" string for the hex centered at the given pixel.
-}
hexPoints : ( Float, Float ) -> String
hexPoints ( cx, cy ) =
    cornerPoints
        |> List.map (\( dx, dy ) -> String.fromFloat (cx + dx) ++ "," ++ String.fromFloat (cy + dy))
        |> String.join " "


{-| The top (and left) edge coordinate of the viewBox for a region radius.
Useful for placing overlays so they stay on screen.
-}
topEdgeFor : Int -> Float
topEdgeFor radius =
    -(size * sqrt3 * (toFloat radius + 1) + size)


{-| A viewBox that frames the finite region with margin.
-}
viewBoxFor : Int -> String
viewBoxFor radius =
    let
        lo =
            String.fromFloat (topEdgeFor radius)

        span =
            String.fromFloat (-2 * topEdgeFor radius)
    in
    lo ++ " " ++ lo ++ " " ++ span ++ " " ++ span
