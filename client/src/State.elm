module State exposing (..)

import Api
import Battle
import Build
import Setup
import Types exposing (..)


{-| Shared application state and messages (kept separate so view modules can
import them without a circular dependency on Main). Form state lives in
`Setup.Model`, build-tool state in `Build.Model`, and battlefield state in
`Battle.Model`; this record holds only the running-play state and UI state.
-}
type alias Flags =
    { apiBase : String
    , fixtureMode : Bool
    , savedSessionId : Maybe String
    }


type Screen
    = Setup
    | Play
    | BattlefieldScreen


{-| The top-level interaction mode: run the game, or author/inspect content.
-}
type Mode
    = PlayMode
    | BuildMode


type ViewMode
    = MapMode
    | ListMode


{-| Which tab the lower side panel (journal / inspector / trace) shows.
-}
type PanelTab
    = TabJournal
    | TabInspector
    | TabTrace


type alias Model =
    { battlefield : Maybe Battle.Model
    , apiBase : String
    , fixtureMode : Bool
    , savedSessionId : Maybe String
    , screen : Screen
    , mode : Mode
    , setup : Setup.Model
    , build : Maybe Build.Model
    , session : Maybe SessionState
    , mapData : Maybe MapData
    , log : List LogEntry
    , viewMode : ViewMode
    , panelTab : PanelTab
    , focusIndex : Int
    , selected : Maybe HexDetail
    , lastResolution : Maybe Resolution
    , busy : Bool
    , error : Maybe String
    , commandCounter : Int
    , hoveredHex : Maybe Axial
    , hoverToken : Int
    , tooltipHex : Maybe Axial
    , spotlightDismissed : Bool
    , positionFlash : Bool
    }


type Msg
    = SetupMsg Setup.Msg
    | BuildMsg Build.Msg
    | OpenBattlefield
    | BattleMsg Battle.Msg
    | GotWorld (Result Api.Error World)
    | GotSession (Result Api.Error SessionState)
    | GotSavedSession (Result Api.Error SessionState)
    | GotSessionState (Result Api.Error SessionState)
    | GotMap (Result Api.Error MapData)
    | GotHistory (Result Api.Error HistoryResponse)
    | TravelTo Axial
    | ChooseOption String
    | GotCommand (Result Api.Error CommandResponse)
    | SelectHex Axial
    | GotHexDetail (Result Api.Error HexDetail)
    | HoverHex Axial
    | HoverEnd
    | ShowTooltip Int Axial
    | NoOp
    | SetViewMode ViewMode
    | SetMode Mode
    | SetPanelTab PanelTab
    | DismissSpotlight
    | ClearPositionFlash
    | CycleReachable Int
    | TravelToFocused
    | KeyDown String
    | Refresh
    | DismissError
