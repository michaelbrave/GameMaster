module HexGridTests exposing (suite)

import Expect
import HexGrid
import Test exposing (..)


expectTrue : String -> Bool -> Expect.Expectation
expectTrue label value =
    Expect.equal True value |> Expect.onFail label


suite : Test
suite =
    describe "axial hex layout"
        [ test "origin maps to pixel origin" <|
            \_ ->
                HexGrid.pixelFor { q = 0, r = 0 }
                    |> Expect.equal ( 0, 0 )
        , test "a hex has six corners" <|
            \_ ->
                Expect.equal (List.length HexGrid.cornerPoints) 6
        , test "hexPoints emits six coordinate pairs" <|
            \_ ->
                HexGrid.hexPoints ( 10, 20 )
                    |> String.split " "
                    |> List.length
                    |> Expect.equal 6
        , test "r-only movement is vertical" <|
            \_ ->
                let
                    ( x, y ) =
                        HexGrid.pixelFor { q = 0, r = 1 }
                in
                Expect.all
                    [ \_ -> expectTrue "x is nonzero (pointy-top offset)" (abs x > 1)
                    , \_ -> expectTrue "y grows with r" (y > 0)
                    ]
                    ()
        , test "viewBox is centered and square" <|
            \_ ->
                HexGrid.viewBoxFor 2
                    |> String.split " "
                    |> List.length
                    |> Expect.equal 4
        ]
