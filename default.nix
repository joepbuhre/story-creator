{ pkgs ? import <nixpkgs> {} }:
let
in
  pkgs.mkShell {
    buildInputs = [
      pkgs.nodejs_21
      pkgs.chromium
    ];
   shellHook = ''
    export PUPPETEER_EXECUTABLE_PATH="$(which chromium)"
  '';
}
