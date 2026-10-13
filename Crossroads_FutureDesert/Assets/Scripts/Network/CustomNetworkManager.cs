using System;
using Mirror;
using UnityEngine;

namespace Crossroads
{
    /// <summary>
    /// NetworkManager with a shareable Room Code.
    /// MVP note: the code is a lobby label for LAN / direct-IP play.
    /// For internet play, host shares their IP (or use a relay such as
    /// Mirror's Edgegap / Steam transport) and clients type it in networkAddress.
    /// </summary>
    public class CustomNetworkManager : NetworkManager
    {
        [Header("Room")]
        public string RoomCode { get; private set; } = "";
        public string LastJoinError { get; private set; } = "";

        const string CodeChars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion

        public string GenerateRoomCode()
        {
            var rng = new System.Random(Guid.NewGuid().GetHashCode());
            var chars = new char[6];
            for (int i = 0; i < chars.Length; i++)
                chars[i] = CodeChars[rng.Next(CodeChars.Length)];
            RoomCode = new string(chars);
            return RoomCode;
        }

        public void HostWithRoomCode()
        {
            GenerateRoomCode();
            Debug.Log($"[Crossroads] Hosting. Room Code: {RoomCode}  Address: {networkAddress}");
            StartHost();
        }

        public void JoinWithRoomCode(string code, string hostAddress)
        {
            RoomCode = (code ?? "").Trim().ToUpperInvariant();
            if (!string.IsNullOrWhiteSpace(hostAddress))
                networkAddress = hostAddress.Trim();
            if (string.IsNullOrWhiteSpace(networkAddress))
            {
                LastJoinError = "Enter the host IP address (LAN) to join.";
                Debug.LogWarning("[Crossroads] " + LastJoinError);
                return;
            }
            Debug.Log($"[Crossroads] Joining room {RoomCode} at {networkAddress}");
            StartClient();
        }

        public override void OnServerAddPlayer(NetworkConnectionToClient conn)
        {
            // Spawn on a slight ring so multiple stickmen don't overlap.
            int slot = NetworkServer.connections.Count;
            float angle = slot * 1.1f;
            var startPos = new Vector3(Mathf.Cos(angle) * 3f, 1f, Mathf.Sin(angle) * 3f);
            GameObject player = Instantiate(playerPrefab, startPos, Quaternion.identity);
            NetworkServer.AddPlayerForConnection(conn, player);
        }

        public override void OnClientDisconnect()
        {
            base.OnClientDisconnect();
            LastJoinError = "Disconnected from host.";
            Debug.LogWarning("[Crossroads] Disconnected from host.");
        }
    }
}
