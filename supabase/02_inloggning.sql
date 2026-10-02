-- Kör denna EN gång om du redan har kört den första versionen av schema.sql.
-- Den låser databasen så att bara inloggade användare kan läsa och ändra.

drop policy if exists "open category"        on category;
drop policy if exists "open ingredient"      on ingredient;
drop policy if exists "open meal"            on meal;
drop policy if exists "open meal_ingredient" on meal_ingredient;

create policy "inloggade category"        on category        for all to authenticated using (true) with check (true);
create policy "inloggade ingredient"      on ingredient      for all to authenticated using (true) with check (true);
create policy "inloggade meal"            on meal            for all to authenticated using (true) with check (true);
create policy "inloggade meal_ingredient" on meal_ingredient for all to authenticated using (true) with check (true);

drop policy if exists "meal images insert" on storage.objects;
drop policy if exists "meal images update" on storage.objects;
drop policy if exists "meal images delete" on storage.objects;

create policy "meal images insert" on storage.objects for insert to authenticated with check (bucket_id = 'meal-images');
create policy "meal images update" on storage.objects for update to authenticated using (bucket_id = 'meal-images');
create policy "meal images delete" on storage.objects for delete to authenticated using (bucket_id = 'meal-images');
