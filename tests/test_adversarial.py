import unittest

import test_registry as fixtures


class AdversarialRegressionTests(unittest.TestCase):
    def test_sql_injection_xss_upload_privacy_and_role_checks(self):
        fixture = fixtures.RegistryTests()
        fixture.setUp()
        try:
            login = fixture.a.post(
                "/api/auth/login",
                json={"username": "' OR 1=1 --", "password": "wrong-password"},
            )
            self.assertEqual(login.status_code, 422)

            model = "x' OR 1=1 --"
            created = fixture.a.post(
                "/api/bikes",
                data={"model": model, "color": "blue", "spot_id": fixture.spots[0]["id"]},
                files={"photo": ("bike.png", fixture.photo, "image/png")},
            )
            self.assertEqual(created.status_code, 201, created.text)
            bike_id = created.json()["id"]

            search = fixture.ad.get("/api/bikes", params={"q": model})
            self.assertEqual([bike["id"] for bike in search.json()], [bike_id])
            self.assertEqual(fixture.a.get("/api/bikes/" + bike_id + "' OR '1'='1").status_code, 404)
            self.assertEqual(fixture.b.get("/api/bikes/" + bike_id).status_code, 404)
            self.assertEqual(fixture.b.get("/api/bikes").json(), [])

            self.assertEqual(
                fixture.a.patch("/api/me", json={"name": "<script>alert(1)</script>"}).status_code,
                200,
            )
            request_id = fixture.request_for(bike_id)["id"]
            statement = fixture.a.get(f"/api/requests/{request_id}/statement")
            self.assertEqual(statement.status_code, 200)
            self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", statement.text)
            self.assertNotIn("<script>alert(1)</script>", statement.text)

            invalid_upload = fixture.a.post(
                "/api/bikes",
                data={"model": "bad", "color": "red", "spot_id": fixture.spots[1]["id"]},
                files={"photo": ("fake.png", b"<script>alert(1)</script>", "image/png")},
            )
            self.assertEqual(invalid_upload.status_code, 422)
            self.assertEqual(
                fixture.a.post(
                    "/api/admin/parkings",
                    json={"name": "X", "capacity": 1, "x": 0, "y": 0},
                ).status_code,
                403,
            )
            self.assertEqual(
                fixture.a.patch("/api/me", json={"name": "Resident", "role": "admin"}).status_code,
                422,
            )
        finally:
            fixture.tearDown()

    def test_qr_remains_stable_and_resolves_new_owner_after_transfer(self):
        fixture = fixtures.RegistryTests()
        fixture.setUp()
        try:
            bike_id = fixture.register(fixture.a)
            self.assertEqual(fixture.approve(bike_id).status_code, 200)
            before = fixture.ad.get(f"/api/qr/bike/{bike_id}.png")
            self.assertEqual(before.status_code, 200)

            transfer = fixture.a.post(
                "/api/requests",
                json={"bike_id": bike_id, "kind": "transfer", "recipient": "bobbb"},
            )
            self.assertEqual(transfer.status_code, 201, transfer.text)
            self.assertEqual(fixture.approve(bike_id).status_code, 200)

            after = fixture.ad.get(f"/api/qr/bike/{bike_id}.png")
            self.assertEqual(after.status_code, 200)
            self.assertEqual(after.content, before.content)

            scan = fixture.b.post(
                "/api/qr/scan",
                files={"photo": ("qr.png", before.content, "image/png")},
            )
            self.assertEqual(scan.status_code, 200, scan.text)
            self.assertEqual(scan.json()["bike"]["owner"]["name"], "Иван")
            self.assertEqual(fixture.a.get(f"/api/bikes/{bike_id}").status_code, 404)
        finally:
            fixture.tearDown()


if __name__ == "__main__":
    unittest.main()
