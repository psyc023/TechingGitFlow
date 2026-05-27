using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PasswordManager.Api.Data;
using PasswordManager.Api.Models;

namespace PasswordManager.Api.Controllers;

[ApiController]
[Route("api/pending-tasks")]
public class PendingTasksController : ControllerBase
{
    private readonly AppDbContext _context;

    public PendingTasksController(AppDbContext context)
    {
        _context = context;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var tasks = await _context.PendingTasks
            .Where(x => x.Active)
            .OrderByDescending(x => x.CreatedAt)
            .ToListAsync();

        return Ok(tasks);
    }

    [HttpPost]
    public async Task<IActionResult> Create(PendingTaskItem item)
    {
        item.CreatedAt = DateTime.Now;
        item.UpdatedAt = DateTime.Now;
        item.Active = true;

        _context.PendingTasks.Add(item);

        await _context.SaveChangesAsync();

        return Ok(item);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> Update(string id, PendingTaskItem item)
    {
        var existing = await _context.PendingTasks.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Title = item.Title;
        existing.Company = item.Company;
        existing.Description = item.Description;
        existing.DueDate = item.DueDate;
        existing.Color = item.Color;
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok(existing);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var existing = await _context.PendingTasks.FindAsync(id);

        if (existing == null)
            return NotFound();

        existing.Active = false;
        existing.DeletedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
        existing.UpdatedAt = DateTime.Now;

        await _context.SaveChangesAsync();

        return Ok();
    }
}