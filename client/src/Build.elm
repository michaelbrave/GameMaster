module Build exposing (Model, Msg(..), init, update, view)

import Api
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onClick, onInput)
import Json.Decode as Decode
import Json.Encode as Encode
import Types exposing (..)
import Util exposing (ifThen)
import Views.Components as Components


{-| Build mode: inspect/edit roll tables, validate drafts, preview seeded
rolls, publish immutable versions, and inspect complete history. Each
capability is gated server-side by the session visibility policy. Self-contained
model/update so the play view never carries build state.
-}
type alias Model =
    { apiBase : String
    , sessionId : String
    , policy : CreatorPolicy
    , readOnly : Bool
    , tab : Tab
    , tables : List TableListItem
    , selectedTable : Maybe String
    , tableJson : Maybe String
    , draft : String
    , validateResult : Maybe ValidateResult
    , previewSeed : String
    , previewCount : Int
    , previewResult : Maybe PreviewResult
    , publishNote : Maybe String
    , creatorHistory : Maybe CreatorHistory
    , error : Maybe String
    }


type Tab
    = TabTables
    | TabHistory


init : { apiBase : String, sessionId : String, policy : CreatorPolicy, readOnly : Bool } -> ( Model, Cmd Msg )
init config =
    let
        model =
            { apiBase = config.apiBase
            , sessionId = config.sessionId
            , policy = config.policy
            , readOnly = config.readOnly
            , tab = TabTables
            , tables = []
            , selectedTable = Nothing
            , tableJson = Nothing
            , draft = ""
            , validateResult = Nothing
            , previewSeed = "preview-1"
            , previewCount = 5
            , previewResult = Nothing
            , publishNote = Nothing
            , creatorHistory = Nothing
            , error = Nothing
            }
    in
    if config.readOnly then
        ( model, Cmd.none )

    else
        ( model, Api.getTables model.apiBase GotTables )


type Msg
    = SetTab Tab
    | LoadTables
    | GotTables (Result Api.Error (List TableListItem))
    | SelectTable String
    | GotTableDetail (Result Api.Error TableVersions)
    | DraftChanged String
    | ValidateDraft
    | GotValidate (Result Api.Error ValidateResult)
    | PreviewSeedChanged String
    | PreviewCountChanged String
    | RunPreview
    | GotPreview (Result Api.Error PreviewResult)
    | PublishDraft
    | GotPublish (Result Api.Error Encode.Value)
    | LoadCreatorHistory
    | GotCreatorHistory (Result Api.Error CreatorHistory)
    | DismissError


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SetTab tab ->
            ( { model | tab = tab }, Cmd.none )

        LoadTables ->
            if model.readOnly then
                ( model, Cmd.none )

            else
                ( model, Api.getTables model.apiBase GotTables )

        GotTables (Ok tables) ->
            ( { model | tables = tables }, Cmd.none )

        GotTables (Err err) ->
            ( { model | error = Just (Api.errorToString err) }, Cmd.none )

        SelectTable tableId ->
            ( { model | selectedTable = Just tableId }
            , Api.getTable model.apiBase tableId GotTableDetail
            )

        GotTableDetail (Ok versions) ->
            let
                latest =
                    List.reverse versions.versions |> List.head

                pretty =
                    latest
                        |> Maybe.map (Encode.encode 2)
                        |> Maybe.withDefault ""
            in
            ( { model | tableJson = Just pretty, draft = pretty, validateResult = Nothing, publishNote = Nothing }
            , Cmd.none
            )

        GotTableDetail (Err err) ->
            ( { model | error = Just (Api.errorToString err) }, Cmd.none )

        DraftChanged value ->
            ( { model | draft = value, publishNote = Nothing }, Cmd.none )

        ValidateDraft ->
            case Decode.decodeString Decode.value model.draft of
                Ok value ->
                    ( model, Api.validateDraft model.apiBase value GotValidate )

                Err parseError ->
                    ( { model
                        | validateResult =
                            Just
                                { valid = False
                                , errors = [ { path = "", message = "draft is not valid JSON: " ++ Decode.errorToString parseError } ]
                                }
                      }
                    , Cmd.none
                    )

        GotValidate (Ok result) ->
            ( { model | validateResult = Just result }, Cmd.none )

        GotValidate (Err err) ->
            ( { model | error = Just (Api.errorToString err) }, Cmd.none )

        PreviewSeedChanged value ->
            ( { model | previewSeed = value }, Cmd.none )

        PreviewCountChanged value ->
            ( { model | previewCount = String.toInt value |> Maybe.withDefault 5 }, Cmd.none )

        RunPreview ->
            case ( Decode.decodeString Decode.value model.draft, model.readOnly ) of
                ( Ok draftValue, False ) ->
                    ( model
                    , Api.previewRolls model.apiBase
                        model.sessionId
                        ( "draft", draftValue )
                        model.previewSeed
                        model.previewCount
                        GotPreview
                    )

                ( Err parseError, _ ) ->
                    ( { model | error = Just ("draft is not valid JSON: " ++ Decode.errorToString parseError) }
                    , Cmd.none
                    )

                _ ->
                    ( model, Cmd.none )

        GotPreview (Ok result) ->
            ( { model | previewResult = Just result }, Cmd.none )

        GotPreview (Err err) ->
            ( { model | previewResult = Nothing, error = Just (Api.errorToString err) }, Cmd.none )

        PublishDraft ->
            case ( Decode.decodeString Decode.value model.draft, model.readOnly ) of
                ( Ok draftValue, False ) ->
                    ( model, Api.publishTable model.apiBase model.sessionId draftValue GotPublish )

                ( Err parseError, _ ) ->
                    ( { model | publishNote = Just ("draft is not valid JSON: " ++ Decode.errorToString parseError) }
                    , Cmd.none
                    )

                _ ->
                    ( model, Cmd.none )

        GotPublish (Ok _) ->
            ( { model | publishNote = Just "Published as a new immutable version." }
            , Api.getTables model.apiBase GotTables
            )

        GotPublish (Err err) ->
            ( { model | publishNote = Just ("Publish failed: " ++ Api.errorToString err) }, Cmd.none )

        LoadCreatorHistory ->
            if model.readOnly then
                ( model, Cmd.none )

            else
                ( model, Api.getCreatorHistory model.apiBase model.sessionId GotCreatorHistory )

        GotCreatorHistory (Ok history) ->
            ( { model | creatorHistory = Just history }, Cmd.none )

        GotCreatorHistory (Err err) ->
            ( { model | creatorHistory = Nothing, error = Just (Api.errorToString err) }, Cmd.none )

        DismissError ->
            ( { model | error = Nothing }, Cmd.none )


view : Model -> Html Msg
view model =
    section [ class "build", attribute "aria-label" "Build tools" ]
        ([ h2 [] [ text "Build tools" ]
         , policySummary model
         , div [ class "tabs", attribute "role" "tablist" ]
            [ button
                [ onClick (SetTab TabTables)
                , class (ifThen (model.tab == TabTables) "tab active" "tab")
                , attribute "role" "tab"
                ]
                [ text "Roll tables" ]
            , button
                [ onClick (SetTab TabHistory)
                , class (ifThen (model.tab == TabHistory) "tab active" "tab")
                , attribute "role" "tab"
                ]
                [ text "Complete history" ]
            ]
         ]
            ++ (case model.tab of
                    TabTables ->
                        [ tablesTab model ]

                    TabHistory ->
                        [ historyTab model ]
               )
            ++ [ Components.errorBanner DismissError model.error ]
        )


policySummary : Model -> Html Msg
policySummary model =
    let
        marker on =
            ifThen on "enabled" "disabled"
    in
    p [ class "policy-note" ]
        [ text
            ("Visibility policy: table preview "
                ++ marker model.policy.tablePreview
                ++ ", complete history "
                ++ marker model.policy.completeHistory
                ++ ". Discovery on the play map remains character-driven."
            )
        ]


tablesTab : Model -> Html Msg
tablesTab model =
    div [ class "tables-tab" ]
        [ div [ class "table-browser" ]
            [ h3 [] [ text "Published tables" ]
            , button [ onClick LoadTables, disabled model.readOnly ] [ text "Reload" ]
            , ul [ class "table-list" ]
                (List.map
                    (\t ->
                        li []
                            [ button
                                [ onClick (SelectTable t.id)
                                , class (ifThen (model.selectedTable == Just t.id) "active" "")
                                ]
                                [ text (t.id ++ " (v" ++ String.fromInt t.latestVersion ++ ", " ++ t.purpose ++ ")") ]
                            ]
                    )
                    model.tables
                )
            ]
        , div [ class "table-editor" ]
            [ h3 [] [ text "Draft (edit, validate, preview, publish)" ]
            , textarea
                [ value model.draft
                , onInput DraftChanged
                , rows 18
                , class "draft"
                , attribute "aria-label" "Table draft JSON"
                ]
                []
            , div [ class "editor-actions" ]
                [ button [ onClick ValidateDraft, disabled model.readOnly ] [ text "Validate" ]
                , button [ onClick RunPreview, disabled model.readOnly ] [ text "Preview rolls" ]
                , button [ onClick PublishDraft, disabled model.readOnly, class "primary" ] [ text "Publish new version" ]
                ]
            , div [ class "editor-actions" ]
                [ label []
                    [ text "Preview seed"
                    , input [ value model.previewSeed, onInput PreviewSeedChanged, disabled model.readOnly ] []
                    ]
                , label []
                    [ text "Count"
                    , input [ type_ "number", value (String.fromInt model.previewCount), onInput PreviewCountChanged, disabled model.readOnly, Html.Attributes.min "1", Html.Attributes.max "50" ] []
                    ]
                ]
            , validateView model
            , publishView model
            , previewView model
            ]
        ]


validateView : Model -> Html Msg
validateView model =
    case model.validateResult of
        Nothing ->
            text ""

        Just result ->
            if result.valid then
                p [ class "valid" ] [ text "Draft is valid." ]

            else
                div [ class "invalid" ]
                    (p [] [ text "Draft has problems:" ]
                        :: List.map (\e -> p [] [ text (e.path ++ ": " ++ e.message) ]) result.errors
                    )


publishView : Model -> Html Msg
publishView model =
    case model.publishNote of
        Nothing ->
            text ""

        Just note ->
            p [ class "hint" ] [ text note ]


previewView : Model -> Html Msg
previewView model =
    case model.previewResult of
        Nothing ->
            text ""

        Just result ->
            div [ class "preview" ]
                [ h4 [] [ text "Preview rolls" ]
                , table []
                    [ thead [] [ tr [] [ th [] [ text "#" ], th [] [ text "Roll" ], th [] [ text "Result" ] ] ]
                    , tbody []
                        (List.concatMap
                            (\p ->
                                List.map
                                    (\roll ->
                                        tr []
                                            [ td [] [ text (String.fromInt p.index) ]
                                            , td [] [ text (selectionText roll.selection) ]
                                            , td [] [ text (roll.selectedEntryId ++ " — " ++ roll.text) ]
                                            ]
                                    )
                                    p.rolls
                            )
                            result.previews
                        )
                    ]
                ]


selectionText : Selection -> String
selectionText selection =
    case selection of
        Weighted w ->
            String.fromInt w.roll ++ "/" ++ String.fromInt w.totalWeight

        DiceRolled d ->
            d.expr ++ " = " ++ String.fromInt d.total


historyTab : Model -> Html Msg
historyTab model =
    div [ class "history-tab" ]
        [ h3 [] [ text "Complete world history (unredacted)" ]
        , button [ onClick LoadCreatorHistory, disabled model.readOnly ] [ text "Load complete history" ]
        , case model.creatorHistory of
            Nothing ->
                p [ class "hint" ]
                    [ text "Loads every event and resolution trace, including system rolls and seeds. Requires the complete-history policy category." ]

            Just history ->
                div []
                    [ p []
                        [ text
                            (String.fromInt (List.length history.events)
                                ++ " events, "
                                ++ String.fromInt (List.length history.resolutions)
                                ++ " resolutions."
                            )
                        ]
                    , h4 [] [ text "Events" ]
                    , ol [ class "creator-events" ] (List.map eventItem history.events)
                    , h4 [] [ text "Resolution traces" ]
                    , ol [ class "creator-resolutions" ] (List.map resolutionItem history.resolutions)
                    ]
        ]


eventItem : Encode.Value -> Html Msg
eventItem value =
    li []
        [ Html.node "details"
            []
            [ Html.node "summary" [] [ text (summarize "type" value) ]
            , pre [ class "json" ] [ text (Encode.encode 2 value) ]
            ]
        ]


resolutionItem : Encode.Value -> Html Msg
resolutionItem value =
    li []
        [ Html.node "details"
            []
            [ Html.node "summary" [] [ text (summarize "commandType" value) ]
            , pre [ class "json" ] [ text (Encode.encode 2 value) ]
            ]
        ]


summarize : String -> Encode.Value -> String
summarize field value =
    case Decode.decodeString (Decode.field field Decode.string) (Encode.encode 0 value) of
        Ok v ->
            v

        Err _ ->
            "entry"
