//! Filtre bon marché avant le parcours profond des fenêtres de navigateur (issue 273).

use super::*;

const NON_MEETING_TITLES: &[&str] = &[
    "Lofi hip hop radio - YouTube — Mozilla Firefox",
    "Inbox (3) - Gmail - Google Chrome",
    "Meet - notes de réunion - Chromium",
    "Slack | général | Équipe - Brave",
    "Zoom - Wikipédia — Mozilla Firefox",
];

const MEETING_TITLES: &[&str] = &[
    "Meet - abc-defg-hij - Google Chrome",
    "Point hebdo - Google Meet — Mozilla Firefox",
    "Réunion | Microsoft Teams - Microsoft Edge",
    "Zoom Meeting - Chromium",
    "Huddle in #général - Slack - Google Chrome",
    "Cisco Webex - Brave",
];

/// Parcours simulé d'un arbre AT-SPI : compte les fenêtres et nœuds visités.
#[derive(Default)]
struct WalkCounter {
    windows: usize,
    nodes: usize,
}

impl WalkCounter {
    fn walk(&mut self, nodes_in_window: usize) {
        self.windows += 1;
        self.nodes += nodes_in_window.min(MAX_NODES);
    }
}

#[test]
fn browser_windows_without_meeting_signal_are_not_walked() {
    let windows = NON_MEETING_TITLES
        .iter()
        .map(|title| (Some(title.to_string()), MAX_NODES))
        .chain([(None, MAX_NODES)])
        .collect::<Vec<_>>();

    let mut counter = WalkCounter::default();
    for (_, nodes) in retain_meeting_browser_windows(windows) {
        counter.walk(nodes);
    }

    assert_eq!(counter.windows, 0);
    assert_eq!(counter.nodes, 0);
}

#[test]
fn browser_windows_with_meeting_signal_are_still_walked() {
    let windows = NON_MEETING_TITLES
        .iter()
        .chain(MEETING_TITLES)
        .enumerate()
        .map(|(index, title)| (Some(title.to_string()), index))
        .collect::<Vec<_>>();

    let kept = retain_meeting_browser_windows(windows)
        .into_iter()
        .map(|(title, _)| title.unwrap())
        .collect::<Vec<_>>();

    assert_eq!(kept, MEETING_TITLES);
}

#[test]
fn skipped_browser_windows_could_never_classify_as_meeting() {
    // Sous Linux, l'URL n'est quasiment jamais exposée par AT-SPI et le titre du
    // document reprend celui de l'onglet : une fenêtre écartée par le filtre
    // n'aurait jamais donné de racine de réunion, même après un parcours complet.
    for title in NON_MEETING_TITLES {
        assert!(!browser_window_may_host_meeting(Some(title)), "{title}");
        let web_area = node(1, "AXWebArea", title, None);
        let controls = vec![
            web_area.clone(),
            node(2, "AXButton", "Leave call", None),
            node(3, "AXButton", "Turn off microphone", None),
        ];
        for complete in [true, false] {
            assert!(matches!(
                browser_meeting_root_from_snapshot(
                    controls.clone(),
                    complete,
                    None,
                    Some(title.to_string()),
                    Some(&web_area),
                ),
                BrowserMeetingSnapshot::Exclude
            ));
        }
    }
}

#[test]
fn skip_reason_does_not_look_like_a_permission_problem() {
    // Le front n'affiche un toast que pour l'autorisation ou le bus
    // d'accessibilité : cette raison doit rester silencieuse.
    assert!(!BROWSER_WITHOUT_MEETING_SIGNAL_WARNING.contains("accessibility permission"));
    assert!(!BROWSER_WITHOUT_MEETING_SIGNAL_WARNING.contains("accessibility bus"));
}

/// Banc d'essai : navigateur ouvert sur une page non-réunion pendant 2 minutes
/// d'écoute. Les trois sondes périodiques qui parcourent l'arbre AT-SPI sont
/// simulées à leur cadence d'origine (chat 5 s, contexte des locuteurs 5 s,
/// partage d'écran 3 s) avec deux fenêtres de navigateur saturant `MAX_NODES`.
#[test]
fn bench_two_minutes_of_listening_with_a_non_meeting_browser_page() {
    const LISTENING_MS: u64 = 120_000;
    let windows = [
        "Lofi hip hop radio - YouTube — Mozilla Firefox",
        "Inbox (3) - Gmail — Mozilla Firefox",
    ];
    let polls = [5_000_u64, 5_000, 3_000]
        .iter()
        .map(|interval| LISTENING_MS / interval)
        .sum::<u64>();

    let mut before = WalkCounter::default();
    let mut after = WalkCounter::default();
    for _ in 0..polls {
        for _ in windows {
            before.walk(MAX_NODES);
        }
        let titled = windows.map(|title| (Some(title.to_string()), MAX_NODES));
        for (_, nodes) in retain_meeting_browser_windows(titled) {
            after.walk(nodes);
        }
    }

    eprintln!(
        "2 min d'écoute, {polls} sondages : avant {} fenêtres / {} nœuds parcourus, après {} / {}",
        before.windows, before.nodes, after.windows, after.nodes
    );
    assert_eq!(before.nodes, polls as usize * windows.len() * MAX_NODES);
    assert_eq!(after.windows, 0);
    assert_eq!(after.nodes, 0);
}
