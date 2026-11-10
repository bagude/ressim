"""Scripted plays for the simulator-backed minigames (shared by the smoke tests)."""
PLAYS = {
    "flowback": [("set_month", {"bhp_psi": 4300}), ("set_month", {"bhp_psi": 3500}), ("set_month", {"bhp_psi": 2500}), ("finish", {})],
    "facility": [("study", {"separator_psi": 100, "oil_cap_bbl_d": 1200, "allocation": "pro_rata", "priority": [1, 2, 3]}),
                 ("build", {"separator_psi": 80, "oil_cap_bbl_d": 2000, "allocation": "common_choke", "priority": [1, 2, 3]})],
    "lift": [("study", {"method": "none"}), ("study", {"method": "gas_lift", "switch_month": 3, "injection_mcf_d": 600}),
             ("install", {"method": "pump", "switch_month": 6, "intake_psi": 250})],
    "diagnostics": [("answer", {"downtime": [5, 9], "frac_hit": 0, "regime": "linear flow (half slope)", "eur10": 300000})],
    "pump-job": [("minifrac", {}),
                 ("pump", {"fluid": "slickwater", "rate_bpm": 20, "minutes": 70, "sand": "100_mesh",
                           "schedule": [[0.2, 0.5], [0.45, 1.0], [0.7, 1.75]]})],
}
