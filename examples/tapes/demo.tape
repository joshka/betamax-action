Require cargo
Set Shell "bash"
Set FontFamily "DejaVu Sans Mono"
Set FontSize 20
Set Width 780
Set Height 350
Set Theme "Catppuccin Mocha"
Set WindowBar Colorful
Set BorderRadius 8
Set WaitTimeout 20s
Hide
Type@0ms "cd \"$BETAMAX_WORKING_DIRECTORY\""
Enter
Type "cargo run --quiet --manifest-path examples/ratatui/Cargo.toml"
Enter
Wait+Screen "Terminal previews"
Show
Sleep 1500ms
Screenshot .artifacts/demo-checkpoint.png
Sleep 1s
