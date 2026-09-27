module Util exposing (ifThen)

{-| Small shared view helper (kept in one place instead of duplicated per view).
-}


ifThen : Bool -> a -> a -> a
ifThen cond yes no =
    if cond then
        yes

    else
        no
