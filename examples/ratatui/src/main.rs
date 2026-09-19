use std::{io, thread, time::Duration};

use ratatui::{
    layout::{Constraint, Layout},
    style::{Color, Style, Stylize},
    widgets::{Block, Gauge, Paragraph},
};

fn main() -> io::Result<()> {
    let mut terminal = ratatui::init();
    let result = (|| {
        for progress in [0, 25, 50, 75, 100] {
            terminal.draw(|frame| {
                let areas = Layout::vertical([
                    Constraint::Length(3),
                    Constraint::Length(3),
                    Constraint::Min(1),
                ])
                .margin(1)
                .split(frame.area());
                let heading = Paragraph::new("Betamax • Terminal previews")
                    .cyan()
                    .block(Block::bordered());
                frame.render_widget(heading, areas[0]);
                let gauge = Gauge::default()
                    .block(Block::bordered().title("Rendering demo"))
                    .gauge_style(Style::default().fg(Color::Green))
                    .percent(progress);
                frame.render_widget(gauge, areas[1]);
                frame.render_widget(Paragraph::new("GIF · PNG · WebP · MP4 · WebM"), areas[2]);
            })?;
            thread::sleep(Duration::from_millis(400));
        }
        Ok(())
    })();
    ratatui::restore();
    result
}
