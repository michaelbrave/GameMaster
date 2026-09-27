module Views.Components exposing (errorBanner)

{-| View fragments shared across screens. Each screen keeps its own Msg type,
so these take the messages they need as parameters.
-}

import Html exposing (Html, button, div, span, text)
import Html.Attributes exposing (attribute, class)
import Html.Events exposing (onClick)


{-| Dismissible error banner. `dismissMsg` is sent when the × button is
clicked; renders nothing when there is no error.
-}
errorBanner : msg -> Maybe String -> Html msg
errorBanner dismissMsg maybeMessage =
    case maybeMessage of
        Nothing ->
            text ""

        Just message ->
            div [ class "error-banner", attribute "role" "alert" ]
                [ span [] [ text message ]
                , button [ onClick dismissMsg, attribute "aria-label" "Dismiss" ] [ text "×" ]
                ]
