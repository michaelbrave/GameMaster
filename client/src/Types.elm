module Types exposing (..)

import Dict exposing (Dict)
import Json.Decode as Decode exposing (..)
import Json.Encode as Encode


{-| Domain types mirroring contracts/json-schema. Decoders are the typed
API boundary between the Elm client and the server.
-}
type alias World =
    { id : String
    , name : String
    , seed : String
    , contentRelease : String
    , currentTick : Int
    , version : Int
    , createdAt : String
    }


world : Decoder World
world =
    Decode.map7 World
        (field "id" string)
        (field "name" string)
        (field "seed" string)
        (field "contentRelease" string)
        (field "currentTick" int)
        (field "version" int)
        (field "createdAt" string)


type alias Axial =
    { q : Int, r : Int }


axial : Decoder Axial
axial =
    map2 Axial (field "q" int) (field "r" int)


type alias TableRef =
    { id : String, version : Int }


tableRef : Decoder TableRef
tableRef =
    map2 TableRef (field "id" string) (field "version" int)


type ChoicePresentation
    = Battlefield


{-| Presentation surface a choice opens, as declared by content. The client
never infers this from a choice id.
-}
choicePresentation : Decoder ChoicePresentation
choicePresentation =
    Decode.andThen
        (\value ->
            case value of
                "battlefield" ->
                    succeed Battlefield

                other ->
                    fail ("unknown choice presentation: " ++ other)
        )
        string


type alias Choice =
    { id : String
    , label : String
    , table : TableRef
    , presentation : Maybe ChoicePresentation
    }


choice : Decoder Choice
choice =
    map4 Choice
        (field "id" string)
        (field "label" string)
        (field "table" tableRef)
        (maybe (field "presentation" choicePresentation))


type alias EncounterCore =
    { encounterId : String
    , tableId : String
    , tableVersion : Int
    , text : String
    , choices : List Choice
    , startedTick : Int
    , hex : Axial
    }


type alias PendingEncounter =
    { encounterId : String
    , tableId : String
    , tableVersion : Int
    , text : String
    , choices : List Choice
    , startedTick : Int
    , hex : Axial
    , asset : Maybe String
    , assetLabel : Maybe String
    }


pendingEncounter : Decoder PendingEncounter
pendingEncounter =
    Decode.map3 buildEncounter
        (Decode.map7 EncounterCore
            (field "encounterId" string)
            (field "tableId" string)
            (field "tableVersion" int)
            (field "text" string)
            (field "choices" (list choice))
            (field "startedTick" int)
            (field "hex" axial)
        )
        (maybe (field "asset" string))
        (maybe (field "assetLabel" string))


buildEncounter : EncounterCore -> Maybe String -> Maybe String -> PendingEncounter
buildEncounter core asset assetLabel =
    { encounterId = core.encounterId
    , tableId = core.tableId
    , tableVersion = core.tableVersion
    , text = core.text
    , choices = core.choices
    , startedTick = core.startedTick
    , hex = core.hex
    , asset = asset
    , assetLabel = assetLabel
    }


type alias CreatorPolicy =
    { tablePreview : Bool, completeHistory : Bool }


creatorPolicy : Decoder CreatorPolicy
creatorPolicy =
    map2 CreatorPolicy
        (field "tablePreview" bool)
        (field "completeHistory" bool)


type alias Session =
    { id : String
    , worldId : String
    , characterName : String
    , position : Axial
    , status : String
    , version : Int
    , creatorPolicy : CreatorPolicy
    , pendingEncounter : Maybe PendingEncounter
    , createdAt : String
    }


andMap : Decoder a -> Decoder (a -> b) -> Decoder b
andMap =
    Decode.map2 (|>)


session : Decoder Session
session =
    Decode.succeed Session
        |> andMap (field "id" string)
        |> andMap (field "worldId" string)
        |> andMap (field "characterName" string)
        |> andMap (field "position" axial)
        |> andMap (field "status" string)
        |> andMap (field "version" int)
        |> andMap (field "creatorPolicy" creatorPolicy)
        |> andMap (field "pendingEncounter" (nullable pendingEncounter))
        |> andMap (field "createdAt" string)


type alias SessionState =
    { session : Session
    , worldTick : Int
    , worldName : String
    , regionRadius : Int
    , reachable : List Axial
    , discoveredCount : Int
    }


sessionState : Decoder SessionState
sessionState =
    Decode.map6 SessionState
        (field "session" session)
        (field "worldTick" int)
        (field "worldName" string)
        (field "regionRadius" int)
        (field "reachable" (list axial))
        (field "discoveredCount" int)


type alias Site =
    { id : String, siteType : String, name : String, tags : List String, asset : Maybe String }


site : Decoder Site
site =
    Decode.map5 Site
        (field "id" string)
        (field "siteType" string)
        (field "name" string)
        (field "tags" (list string))
        (maybe (field "asset" string))


type alias Fact =
    { id : String, category : String, tags : List String, createdTick : Int }


fact : Decoder Fact
fact =
    Decode.map4 Fact
        (field "id" string)
        (field "category" string)
        (field "tags" (list string))
        (field "createdTick" int)


type alias Marker =
    { key : String, label : String, icon : String }


marker : Decoder Marker
marker =
    map3 Marker (field "key" string) (field "label" string) (field "icon" string)


type alias HexSummary =
    { q : Int
    , r : Int
    , terrain : String
    , terrainLabel : String
    , tags : List String
    , sites : List Site
    , facts : List Fact
    , markers : List Marker
    , visitedTick : Int
    }


hexSummary : Decoder HexSummary
hexSummary =
    Decode.succeed HexSummary
        |> andMap (field "q" int)
        |> andMap (field "r" int)
        |> andMap (field "terrain" string)
        |> andMap (field "terrainLabel" string)
        |> andMap (field "tags" (list string))
        |> andMap (field "sites" (list site))
        |> andMap (field "facts" (list fact))
        |> andMap (field "markers" (list marker))
        |> andMap (field "visitedTick" int)


type alias TerrainLegend =
    { label : String, moveCost : Int, passable : Bool, glyph : String, color : String }


terrainLegend : Decoder TerrainLegend
terrainLegend =
    Decode.map5 TerrainLegend
        (field "label" string)
        (field "moveCost" int)
        (field "passable" bool)
        (field "glyph" string)
        (field "color" string)


type alias MapData =
    { worldTick : Int
    , position : Axial
    , regionRadius : Int
    , reachable : List Axial
    , hexes : List HexSummary
    , gridType : String
    , legend : Dict String TerrainLegend
    }


mapData : Decoder MapData
mapData =
    Decode.map7 MapData
        (field "worldTick" int)
        (field "position" axial)
        (field "regionRadius" int)
        (field "reachable" (list axial))
        (field "hexes" (list hexSummary))
        (field "gridType" string)
        (field "legend" (dict terrainLegend))


type alias LogEntry =
    { seq : Int, tick : Int, entryType : String, location : Maybe Axial, text : String }


logEntry : Decoder LogEntry
logEntry =
    Decode.map5 LogEntry
        (field "seq" int)
        (field "tick" int)
        (field "type" string)
        (field "location" (nullable axial))
        (field "text" string)


type alias HistoryResponse =
    { entries : List LogEntry, total : Int, offset : Int, limit : Int }


historyResponse : Decoder HistoryResponse
historyResponse =
    Decode.map4 HistoryResponse
        (field "entries" (list logEntry))
        (field "total" int)
        (field "offset" int)
        (field "limit" int)


type Selection
    = Weighted { roll : Int, totalWeight : Int }
    | DiceRolled { expr : String, dice : List Int, total : Int }


selection : Decoder Selection
selection =
    field "mode" string |> Decode.andThen selectionByMode


selectionByMode : String -> Decoder Selection
selectionByMode mode =
    case mode of
        "weighted" ->
            Decode.map2 (\roll totalWeight -> Weighted { roll = roll, totalWeight = totalWeight })
                (field "roll" int)
                (field "totalWeight" int)

        "dice" ->
            Decode.map3 (\expr dice total -> DiceRolled { expr = expr, dice = dice, total = total })
                (field "expr" string)
                (field "dice" (list int))
                (field "total" int)

        _ ->
            Decode.fail ("unknown selection mode: " ++ mode)


type alias RollRecord =
    { tableId : String
    , tableVersion : Int
    , label : String
    , purpose : String
    , depth : Int
    , selection : Selection
    , selectedEntryId : String
    , text : String
    }


rollRecord : Decoder RollRecord
rollRecord =
    Decode.map8 RollRecord
        (field "tableId" string)
        (field "tableVersion" int)
        (field "label" string)
        (field "purpose" string)
        (field "depth" int)
        (field "selection" selection)
        (field "selectedEntryId" string)
        (field "text" string)


type alias Resolution =
    { id : String
    , command : String
    , outcome : String
    , worldTick : Int
    , text : List String
    , rolls : List RollRecord
    , events : List Encode.Value
    }


resolution : Decoder Resolution
resolution =
    Decode.map7 Resolution
        (field "id" string)
        (field "command" string)
        (field "outcome" string)
        (field "worldTick" int)
        (field "text" (list string))
        (field "rolls" (list rollRecord))
        (field "events" (list Decode.value))


type alias CommandSession =
    { id : String, version : Int, position : Axial, pendingEncounter : Maybe PendingEncounter }


commandSession : Decoder CommandSession
commandSession =
    Decode.map4 CommandSession
        (field "id" string)
        (field "version" int)
        (field "position" axial)
        (field "pendingEncounter" (nullable pendingEncounter))


type alias CommandResponse =
    { resolution : Resolution
    , session : CommandSession
    , worldTick : Int
    }


commandResponse : Decoder CommandResponse
commandResponse =
    Decode.map3 CommandResponse
        (field "resolution" resolution)
        (field "session" commandSession)
        (field "worldTick" int)


type alias HexDetail =
    { hex : HexSummary, history : List LogEntry }


hexDetail : Decoder HexDetail
hexDetail =
    Decode.map2 HexDetail
        (field "hex" hexSummary)
        (field "history" (list logEntry))


type alias TableListItem =
    { id : String, purpose : String, label : String, versions : List Int, latestVersion : Int }


tableListItem : Decoder TableListItem
tableListItem =
    Decode.map5 TableListItem
        (field "id" string)
        (field "purpose" string)
        (field "label" string)
        (field "versions" (list int))
        (field "latestVersion" int)


tableList : Decoder (List TableListItem)
tableList =
    field "tables" (list tableListItem)


type alias TableVersions =
    { id : String, versions : List Encode.Value }


tableVersions : Decoder TableVersions
tableVersions =
    Decode.map2 TableVersions
        (field "id" string)
        (field "versions" (list Decode.value))


type alias ValidationProblem =
    { path : String, message : String }


type alias ValidateResult =
    { valid : Bool, errors : List ValidationProblem }


validateResult : Decoder ValidateResult
validateResult =
    Decode.map2 ValidateResult
        (field "valid" bool)
        (field "errors" (list (map2 ValidationProblem (field "path" string) (field "message" string))))


type alias PreviewRoll =
    { index : Int, seed : String, rolls : List RollRecord, text : List String }


type alias PreviewResult =
    { previews : List PreviewRoll }


previewResult : Decoder PreviewResult
previewResult =
    Decode.map PreviewResult
        (field "previews"
            (list
                (Decode.map4 PreviewRoll
                    (field "index" int)
                    (field "seed" string)
                    (field "rolls" (list rollRecord))
                    (field "text" (list string))
                )
            )
        )


type alias CreatorHistory =
    { events : List Encode.Value, resolutions : List Encode.Value }


creatorHistory : Decoder CreatorHistory
creatorHistory =
    Decode.map2 CreatorHistory
        (field "events" (list Decode.value))
        (field "resolutions" (list Decode.value))
