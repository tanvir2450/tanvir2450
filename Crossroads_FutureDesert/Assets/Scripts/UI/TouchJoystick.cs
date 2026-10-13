using Mirror;
using UnityEngine;
using UnityEngine.EventSystems;

namespace Crossroads
{
    /// <summary>Left-thumb virtual joystick + FIRE button wiring for the local player.</summary>
    public class TouchJoystick : MonoBehaviour, IDragHandler, IPointerDownHandler, IPointerUpHandler
    {
        public RectTransform knob;
        public float radius = 60f;

        MobileTouchController player;
        RectTransform rect;

        void Awake() => rect = GetComponent<RectTransform>();

        void Update()
        {
            if (player == null && NetworkClient.localPlayer != null)
                player = NetworkClient.localPlayer.GetComponent<MobileTouchController>();
        }

        public void OnPointerDown(PointerEventData e) => OnDrag(e);

        public void OnDrag(PointerEventData e)
        {
            if (RectTransformUtility.ScreenPointToLocalPointInRectangle(rect, e.position, e.pressEventCamera, out Vector2 local))
            {
                Vector2 clamped = Vector2.ClampMagnitude(local, radius);
                if (knob != null) knob.anchoredPosition = clamped;
                if (player != null) player.SetMoveInput(clamped / radius);
            }
        }

        public void OnPointerUp(PointerEventData e)
        {
            if (knob != null) knob.anchoredPosition = Vector2.zero;
            if (player != null) player.SetMoveInput(Vector2.zero);
        }

        /// <summary>Wire the FIRE button's OnClick to this.</summary>
        public void OnFireButton()
        {
            if (player == null && NetworkClient.localPlayer != null)
                player = NetworkClient.localPlayer.GetComponent<MobileTouchController>();
            NetworkClient.localPlayer?.GetComponent<WeaponShooter>()?.FireButton();
        }
    }
}
