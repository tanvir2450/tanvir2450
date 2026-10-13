# Crossroads: Future Desert — MVP

A ready-to-open Unity multiplayer prototype: neon stickman, neon desert,
Mirror networking (Host/Client), WASD+mouse in the Editor, virtual
joystick + FIRE button on mobile.

## Run it (2 minutes)

1. Install **Unity 2022.3.45f1** (Unity Hub → Installs → LTS) with the
   Android/iOS Build Support module if you want a phone build.
2. Unity Hub → **Add → Add project from disk** → select this
   `Crossroads_FutureDesert` folder. Open it and wait for the first
   import (Mirror + Input System download automatically from
   `Packages/manifest.json`).
3. The scene builds itself on first import
   (`Assets/Editor/CrossroadsSetup.cs` creates
   `Assets/Scenes/FutureDesert.unity`, the `Player_Stickman` prefab,
   the `NeonSand` material, the NetworkManager and the mobile HUD).
   If it doesn't, use menu **Crossroads → Build MVP Scene**.
4. Press **Play** → click **Host (Server + Client)** in Mirror's
   on-screen GUI → your stickman spawns. Move with **WASD**, look with
   the **mouse**, click to shoot.

## Play with a friend (LAN)

- Host: Play → Host. Note your LAN IP (`ipconfig` / network settings).
- Client: set the NetworkManager **Network Address** to the host IP
  (or use `CustomNetworkManager.JoinWithRoomCode(code, hostIp)` from
  your lobby UI — the room code is a lobby label for MVP; internet play
  needs a relay/Steam transport, planned next).

## Phone build

`File → Build Settings → Android (or iOS) → Switch Platform`, then:
Player Settings → Landscape orientation, Minimum API 26+,
Internet Access = **Require**. `Build and Run` with USB debugging on.
The on-screen joystick (bottom-left) calls
`MobileTouchController.SetMoveInput()` and the FIRE button calls
`WeaponShooter.FireButton()`.

## Layout

| Path | Contents |
|---|---|
| `Assets/Scripts/Player/` | `MobileTouchController`, `WeaponShooter`, `PlayerHealth` |
| `Assets/Scripts/Network/` | `CustomNetworkManager` (room codes, spawn ring) |
| `Assets/Scripts/UI/` | `TouchJoystick` (joystick + FIRE wiring) |
| `Assets/Editor/` | `CrossroadsSetup` — auto-builds prefab/scene/HUD |

## Troubleshooting

- **"Player prefab has no NetworkIdentity"** → re-run
  *Crossroads → Build MVP Scene* (don't hand-edit the prefab's components).
- **Double/ghost cameras** → the prefab camera must stay **disabled**;
  `MobileTouchController.OnStartLocalPlayer()` enables it only locally.
- **Falling through the floor** → keep only `CharacterController` on the
  player; never add a `CapsuleCollider` as well.
