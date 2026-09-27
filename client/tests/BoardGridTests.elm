module BoardGridTests exposing (suite)

import BoardGrid
import Expect
import HexGrid
import Test exposing (..)


suite : Test
suite =
    describe "square and diamond board"
        [ test "corner stop is halfway between diagonal tile centers" <|
            \_ ->
                Expect.equal
                    [ ( 0, 0 ), ( 34, 34 ), ( 68, 68 ), ( 68, 0 ) ]
                    (List.map (BoardGrid.pixelFor "square-diamond")
                        [ { q = 0, r = 0 }, { q = 1, r = 1 }, { q = 2, r = 2 }, { q = 2, r = 0 } ]
                    )
        , test "cut corners meet the diamond edges exactly" <|
            \_ ->
                let
                    large =
                        String.split " " (BoardGrid.points "square-diamond" { q = 0, r = 0 })

                    corner =
                        String.split " " (BoardGrid.points "square-diamond" { q = 1, r = 1 })
                in
                Expect.equal ( 8, 4, True )
                    ( List.length large
                    , List.length corner
                    , List.all (\point -> List.member point large && List.member point corner) [ "34,20", "20,34" ]
                    )
        , test "negative odd coordinates are diamonds" <|
            \_ -> Expect.equal True (BoardGrid.isDiamond "square-diamond" { q = -1, r = -1 })
        , test "legacy hex geometry stays identical" <|
            \_ -> Expect.equal (HexGrid.pixelFor { q = 1, r = -1 }) (BoardGrid.pixelFor "hex" { q = 1, r = -1 })
        ]
