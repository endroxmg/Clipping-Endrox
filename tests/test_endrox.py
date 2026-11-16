"""Offline selection checks. Run with python -m unittest tests.test_endrox."""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from unittest.mock import Mock, patch
import numpy as np
from studio import brain, highlights


class EditorialSelection(unittest.TestCase):
    def test_candidate_quote_has_to_be_in_its_own_range(self):
        words = [{"w":"नॉक", "s":3}, {"w":"हुआ।", "s":4}, {"w":"clutch", "s":60}]
        candidate = {"start":0, "end":10, "quote":"नॉक हुआ"}
        self.assertTrue(brain._grounded(candidate, words))
        self.assertFalse(brain._grounded({**candidate,"quote":"squad wiped"}, words))
        self.assertFalse(brain._grounded({**candidate,"start":20,"end":30}, words))

    def test_late_payoff_outranks_earlier_duplicate(self):
        candidates = [dict(start=0,end=20,score=50),dict(start=590,end=612,score=87),
                      dict(start=598,end=615,score=94)]
        self.assertEqual(highlights.diverse(candidates,1), [candidates[-1]])

    def test_silent_static_frame_does_not_generate_gameplay_highlight(self):
        self.assertEqual(highlights.action_candidates(np.zeros(30),np.ones(30),3,30,10,20),[])
        motion = np.zeros(30)
        motion[21] = 4
        picks = highlights.action_candidates(motion,np.ones(30),3,30,10,20)
        self.assertEqual(len(picks),1)
        self.assertLessEqual(picks[0]["start"],21)
        self.assertGreater(picks[0]["end"],21)


class WebcamComposition(unittest.TestCase):
    def test_default_action_crop_excludes_the_camera(self):
        from studio.composition import gameplay_crop
        for face in ([0,.3,.25,.25],[.76,.2,.24,.3],[.35,0,.28,.2]):
            x,y,w,h = gameplay_crop(face)
            fx,fy,fw,fh = face
            self.assertTrue(x >= fx+fw or y >= fy+fh or x+w <= fx or y+h <= fy)

    def test_rejects_out_of_frame_and_nonfinite_edits(self):
        from studio.composition import clean
        for settings in ({"face":[.8,.2,.4,.2]},{"caption":[0,0,0,.2]},{"shift":float("nan")}):
            with self.assertRaises(ValueError):
                clean(settings)

    def test_caption_band_and_offset_reach_export(self):
        from studio import composition,render
        settings = composition.clean({"caption":[.1,.8,.8,.1],"shift":.3})
        ass = render.build_ass([{"w":"Hello!","s":11.0,"e":11.8}],10,14,"","violet",[],0,0,settings)
        self.assertIn("0:00:01.30",ass)
        self.assertIn("Hello!",ass)
        self.assertRegex(ass,r"pos\(540,16\d\d\)")


class ClipTiming(unittest.TestCase):
    def test_retiming_adds_speech_without_restoring_deleted_words(self):
        from studio import jobs
        words = [{"w":text, "s":t, "e":t+.6} for t,text in
                 [(761,"kill"), (763,"wrong"), (764,"deleted"), (772,"aftermath")]]
        clip = {"start":758, "end":775, "retime_from":[763,770],
                "caption_track":[{"w":"Corrected!", "s":763, "e":763.9}]}
        track = jobs.retimed_captions({"options":{"caption_language":"spoken"}}, clip, words)
        self.assertEqual([w["w"] for w in track], ["kill", "Corrected!", "aftermath"])
        self.assertEqual([w["s"] for w in track], [761,763,772])
        self.assertEqual(jobs.source_bounds({"duration":3600}, {"src_offset":760,"src_end":774}), (760,774))

    def test_live_capture_waits_for_editable_tail_or_end_of_stream(self):
        from studio import live
        for ended, expected_end in [(False,45),(True,35)]:
            with self.subTest(ended=ended), TemporaryDirectory() as folder:
                session = live.Session.__new__(live.Session)
                session.dir = Path(folder)
                (session.dir / "clips").mkdir()
                source = session.dir / "piece.ts"
                source.touch()
                session.lock, session.ended, session.clock_fix = Lock(), ended, 0.
                session.job, session.words = {"width":640}, []
                session.segments = [(source,t,t+5) for t in range(0,35,5)]
                session._scan_segments = Mock()
                session._align = lambda src, offset, duration: offset
                clip = {"id":"one","start":25,"end":30}
                def next_pieces(_):
                    session.segments.extend((source,t,t+5) for t in (35,40))
                with patch.object(live.time,"sleep",side_effect=next_pieces) as wait, \
                     patch.object(live.media,"run"), patch.object(live.jobs,"render_one") as render:
                    session._render(clip)
                self.assertEqual(wait.call_count, int(not ended))
                self.assertEqual((clip["src_offset"],clip["src_end"]),(10,expected_end))
                render.assert_called_once()
