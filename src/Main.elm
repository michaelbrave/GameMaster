module Main exposing (main)

import Browser
import Html exposing (Html, div, h1, text)
import Html.Attributes exposing (class)

main : Program () Model Msg
main =
    Browser.sandbox { init = init, update = update, view = view }

type alias Model = {}

type Msg = NoOp

init : Model
init = {}

update : Msg -> Model -> Model
update msg model =
    case msg of
        NoOp -> model

view : Model -> Html Msg
view model =
    div [ class "app" ]
        [ h1 [] [ text "Worldforge" ]
        , div [ class "tagline" ] [ text "Fantasy World & GameMaster Tools" ]
        ]