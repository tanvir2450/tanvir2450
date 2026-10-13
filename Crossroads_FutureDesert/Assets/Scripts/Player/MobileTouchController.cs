using Mirror;
using UnityEngine;

namespace Crossroads
{
    /// <summary>
    /// Local-player movement: WASD + mouse in the Editor, virtual joystick on mobile.
    /// Only the local player gets an enabled camera / controls (multiplayer-safe).
    /// Attach to Player_Stickman prefab alongside CharacterController + NetworkIdentity.
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    [RequireComponent(typeof(NetworkIdentity))]
    public class MobileTouchController : NetworkBehaviour
    {
        [Header("Movement")]
        public float moveSpeed = 5f;
        public float gravity = -20f;
        public float mouseSensitivity = 2.5f;

        [Header("Camera")]
        public Camera playerCamera;          // child camera, stays DISABLED in the prefab
        public float minPitch = -60f;
        public float maxPitch = 70f;

        CharacterController controller;
        Vector2 touchMoveInput;              // set by the on-screen joystick
        float pitch;
        float verticalVelocity;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            if (playerCamera == null)
                playerCamera = GetComponentInChildren<Camera>(true);
        }

        public override void OnStartLocalPlayer()
        {
            base.OnStartLocalPlayer();

            // Only enable camera + controls for the person actually playing.
            if (playerCamera == null)
                playerCamera = GetComponentInChildren<Camera>(true);
            if (playerCamera != null)
            {
                playerCamera.enabled = true;
                playerCamera.tag = "MainCamera";
                if (playerCamera.GetComponent<AudioListener>() == null)
                    playerCamera.gameObject.AddComponent<AudioListener>();
            }

#if !UNITY_EDITOR && (UNITY_ANDROID || UNITY_IOS)
            // Touch devices: don't fight the virtual joystick with mouse look.
            mouseSensitivity = 0f;
#endif
        }

        /// <summary>Called by the mobile virtual joystick (TouchJoystick.cs).</summary>
        public void SetMoveInput(Vector2 input) => touchMoveInput = Vector2.ClampMagnitude(input, 1f);

        void Update()
        {
            if (!isLocalPlayer || controller == null) return;

            // --- Move input: keyboard (Editor/testing) merged with touch joystick ---
            Vector2 input = touchMoveInput;
            float kbX = Input.GetAxisRaw("Horizontal");   // A / D
            float kbZ = Input.GetAxisRaw("Vertical");     // W / S
            if (Mathf.Abs(kbX) > 0.01f || Mathf.Abs(kbZ) > 0.01f)
                input = new Vector2(kbX, kbZ);
            input = Vector2.ClampMagnitude(input, 1f);

            Vector3 move = transform.right * input.x + transform.forward * input.y;

            // --- Gravity (CharacterController has its own capsule; no CapsuleCollider!) ---
            verticalVelocity = controller.isGrounded && verticalVelocity < 0f ? -2f : verticalVelocity + gravity * Time.deltaTime;
            move = move * moveSpeed;
            move.y = verticalVelocity;
            controller.Move(move * Time.deltaTime);

            // --- Mouse look (Editor / desktop testing; disabled on touch devices) ---
            if (mouseSensitivity > 0f)
            {
                float yaw = Input.GetAxis("Mouse X") * mouseSensitivity;
                pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * mouseSensitivity, minPitch, maxPitch);
                transform.Rotate(Vector3.up * yaw);
                if (playerCamera != null)
                    playerCamera.transform.localRotation = Quaternion.Euler(pitch, 0f, 0f);
            }
        }

        void OnDisable()
        {
            if (playerCamera != null && isLocalPlayer) playerCamera.enabled = false;
        }
    }
}
